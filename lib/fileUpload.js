// MiMo file-upload client — file-priming birth path.
//
// Wire facts (verified live, Sept 23 2026, mimo-v2.6-pro):
//   1. POST /open-apis/resource/genUploadInfo {fileName, fileContentMd5}
//      → {resourceId, resourceUrl, uploadUrl, objectName}
//   2. PUT <uploadUrl> raw bytes — REQUIRES 'content-md5' + 'content-type:
//      application/octet-stream' headers or Galaxy FDS 403 'Signature Does
//      Not Match'.
//   3. POST /open-apis/resource/parse?fileUrl=<encoded resourceUrl>
//      → {id, bytes, tokenUsage}; id becomes multiMedias[].url
//   4. /bot/chat multiMedias[] = {mediaType:'file', fileUrl, name, size,
//      status:'completed', objectName, url:<parse-id>, tokenUsage}
//
// Ceiling facts that shape this module:
//   - File ingestion cap ~102,400 chars per message; files in ONE message
//     SHARE that cap (2×102k files → 50.2% each). So: ONE file per turn.
//   - Query text has its OWN separate ~100k-char budget that stacks with
//     the file budget in the same message.
//   - Conversation history is committed server-side per request — priming
//     turns can be fired back-to-back without waiting for their streams.

import crypto from 'crypto';

var BASE_URL = 'https://aistudio.xiaomimimo.com';

var FILE_CHUNK_CHARS = parseInt(process.env.FILE_CHUNK_CHARS) || 100000; // stay under 102.4k ingestion cap

function buildHeaders(cookie) {
  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'cookie': cookie,
    'origin': BASE_URL,
    'referer': BASE_URL + '/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'x-timezone': 'UTC'
  };
}

function cookieOf(account) {
  return 'xiaomichatbot_serviceToken="' + account.service_token + '"; userId=' + account.user_id + '; xiaomichatbot_ph="' + account.ph_token + '"';
}

/**
 * Upload a text file and return a multiMedias entry for /bot/chat.
 * @param {object} account  DB account row (service_token, user_id, ph_token)
 * @param {string} content  File body (text)
 * @param {string} phEncoded encodeURIComponent(account.ph_token)
 * @param {string} nameHint Base name for the file (e.g. 'context-part-1')
 * @returns {Promise<object>} multiMedias entry
 */
export async function uploadFile(account, content, phEncoded, nameHint) {
  var buf = Buffer.from(String(content), 'utf8');
  var md5 = crypto.createHash('md5').update(buf).digest('hex');
  var tagged = (nameHint || 'ctx') + '-' + crypto.randomBytes(8).toString('hex') + '.txt';
  var cookie = cookieOf(account);
  var H = buildHeaders(cookie);

  var giRes = await fetch(BASE_URL + '/open-apis/resource/genUploadInfo?xiaomichatbot_ph=' + phEncoded, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ fileName: tagged, fileContentMd5: md5 })
  });
  if (!giRes.ok) throw new Error('genUploadInfo HTTP ' + giRes.status);
  var gi = await giRes.json();
  if (gi.code !== 0) throw new Error('genUploadInfo rejected: ' + JSON.stringify(gi).slice(0, 200));

  var put = await fetch(gi.data.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', 'content-md5': md5 },
    body: buf
  });
  if (!put.ok) throw new Error('FDS PUT HTTP ' + put.status);

  var parseRes = await fetch(BASE_URL + '/open-apis/resource/parse?fileUrl=' + encodeURIComponent(gi.data.resourceUrl) + '&xiaomichatbot_ph=' + phEncoded, {
    method: 'POST',
    headers: H,
    body: '{}'
  });
  if (!parseRes.ok) throw new Error('parse HTTP ' + parseRes.status);
  var parse = await parseRes.json();
  if (parse.code !== 0) throw new Error('parse rejected: ' + JSON.stringify(parse).slice(0, 200));

  return {
    mediaType: 'file',
    fileUrl: gi.data.resourceUrl,
    compressedVideoUrl: '',
    audioTrackUrl: '',
    name: tagged,
    size: buf.length,
    status: 'completed',
    objectName: gi.data.objectName,
    url: parse.data.id,
    tokenUsage: parse.data.tokenUsage
  };
}

/**
 * Fire ONE file-priming turn: attach the file to a chat message on the given
 * conversation. Does NOT wait for the model's ack stream to finish — history
 * is committed server-side per request, so we only confirm the request was
 * accepted (HTTP 200 + first stream bytes) and drain the rest in background.
 * @param {object} account        DB account row
 * @param {string} conversationId MiMo conversation id
 * @param {object} multiMedias    single multiMedias entry (from uploadFile)
 * @param {string} phEncoded      encoded ph token
 * @param {string} modelId        model id for the ack turn
 * @param {AbortSignal} signal    optional abort signal
 * @returns {Promise<number>} seconds until acceptance confirmed
 */
export async function fireFileTurn(account, conversationId, multiMedias, phEncoded, modelId, signal) {
  var msgId = crypto.randomBytes(16).toString('hex');
  var cookie = cookieOf(account);
  var url = BASE_URL + '/open-apis/bot/chat?xiaomichatbot_ph=' + phEncoded;
  var t0 = Date.now();

  var res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(cookie),
    body: JSON.stringify({
      msgId: msgId,
      conversationId: conversationId,
      query: 'Reference document filed. Note its contents and acknowledge in one short sentence.',
      isEditedQuery: false,
      modelConfig: { enableThinking: false, webSearchStatus: 'disabled', model: modelId || 'mimo-v2.5-pro' },
      multiMedias: [multiMedias]
    }),
    signal: signal
  });
  if (!res.ok) {
    var errText = '';
    try { errText = (await res.text()).slice(0, 200); } catch (e) {}
    throw new Error('File turn HTTP ' + res.status + ' ' + errText);
  }

  // Confirm the stream actually started (guards against the silent
  // empty-stream failure mode), then drain in background without blocking.
  var reader = res.body.getReader();
  var first = await reader.read();
  if (!first.value || first.value.length === 0) {
    try { reader.cancel(); } catch (e) {}
    throw new Error('File turn accepted but empty stream');
  }
  (async function () {
    try { while (true) { var r = await reader.read(); if (r.done) break; } } catch (e) { /* abandoned ack drain */ }
  })();
  return (Date.now() - t0) / 1000;
}

export { FILE_CHUNK_CHARS };
