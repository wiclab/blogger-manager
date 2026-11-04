/**
 * ChatGPT -> private Google Drive document -> Blogger DRAFT ONLY.
 * Runs under the blog owner's own Google Apps Script OAuth authorization.
 * No publication/deletion/updates; never stores Google tokens outside Apps Script.
 *
 * REQUIRED Script Properties:
 *   BLOG_ID (numeric Blogger blog ID)
 *   INBOX_FOLDER_ID (private Google Drive folder ID)
 * Do not paste OAuth tokens or passwords into this source.
 */
const BRIDGE = Object.freeze({
  host: 'wic12.blogspot.com',
  namePrefix: 'READY__',
  maxPerRun: 3,
  maxPages: 12,
  maxHtmlChars: 100000,
});

function installDraftInboxTrigger() {
  const cfg = bridgeConfig_();
  verifyTargetBlog_(cfg.blogId);
  const triggerName = 'processDraftInbox';
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === triggerName)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(triggerName).timeBased().everyMinutes(5).create();
}

function processDraftInbox() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const cfg = bridgeConfig_();
    verifyTargetBlog_(cfg.blogId);
    const folder = DriveApp.getFolderById(cfg.folderId);
    const files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
    let processed = 0;
    while (files.hasNext() && processed < BRIDGE.maxPerRun) {
      const file = files.next();
      if (!file.getName().startsWith(BRIDGE.namePrefix)) continue;
      const key = 'draft:' + file.getId();
      const store = PropertiesService.getScriptProperties();
      if (store.getProperty(key)) continue;
      processed++;
      try {
        const bodyText = DocumentApp.openById(file.getId()).getBody().getText();
        const item = parseAndValidate_(bodyText);
        if (draftAlreadyExists_(cfg.blogId, item)) {
          store.setProperty(key, JSON.stringify({status:'DUPLICATE_REVIEW',at:new Date().toISOString()}));
          file.setName('REVIEW_DUPLICATE__' + file.getName().slice(BRIDGE.namePrefix.length));
          continue;
        }
        // Record before the network POST. A failed/ambiguous POST is NOT auto-retried,
        // because Blogger may already have created the draft.
        store.setProperty(key, JSON.stringify({status:'IN_FLIGHT',at:new Date().toISOString()}));
        const payload = {
          kind:'blogger#post',
          blog:{id:cfg.blogId},
          title:item.title,
          content:item.html,
          labels:[item.label],
        };
        const created = bloggerApi_(cfg.blogId, '/posts?isDraft=true', 'post', payload);
        if (!created || !/^\d+$/.test(String(created.id)) ||
            String(created.status).toUpperCase() !== 'DRAFT') {
          throw new Error('Creation response was not a verified DRAFT');
        }
        const checked = bloggerApi_(cfg.blogId, '/posts/' + encodeURIComponent(created.id) +
           '?view=ADMIN', 'get');
        if (!checked || String(checked.status).toUpperCase() !== 'DRAFT' ||
            checked.title !== item.title) {
          throw new Error('Blogger draft read-back did not match');
        }
        const result = {
          status:'DRAFT_SAVED_NEEDS_SETTINGS',
          postId:String(created.id),
          editUrl:'https://www.blogger.com/blog/post/edit/' + cfg.blogId + '/' + created.id,
          imageUrl:item.imageUrl || null,
          needsBloggerPermalink:true,
          needsBloggerSearchDescription:true,
          needsImageUpload:!item.imageUrl,
          at:new Date().toISOString(),
        };
        store.setProperty(key, JSON.stringify(result));
        file.setName('SAVED_NEEDS_SETTINGS__' + file.getName().slice(BRIDGE.namePrefix.length));
        // Sidecar image jobs are non-native JSON files that Drive for desktop can sync.
        // Never attempt to create another Blogger post if sidecar preparation fails.
        try {
          const queue = prepareDraftImageQueue_(folder, file, item, cfg.blogId, result.postId);
          result.imageQueue = queue.status;
          result.imageName = item.slug + '-featured.png';
        } catch (queueError) {
          result.imageQueue = 'REVIEW_IMAGE_QUEUE';
          result.imageQueueError = String(queueError.message || queueError).slice(0,150);
        }
        store.setProperty(key, JSON.stringify(result));
        console.log(JSON.stringify({docId:file.getId(),...result}));
      } catch (err) {
        // Deliberately no automatic retry after any attempted POST.
        const prior = store.getProperty(key);
        const state = prior ? JSON.parse(prior) : {};
        store.setProperty(key, JSON.stringify({
          status:'NEEDS_MANUAL_REVIEW',
          attemptedWrite:state.status === 'IN_FLIGHT',
          reason:String(err && err.message || err).slice(0,180),
          at:new Date().toISOString(),
        }));
        try {file.setName('REVIEW_FAILED__' +
          file.getName().replace(/^READY__/, ''));} catch (_) {}
        console.error('Draft bridge stopped for document ' + file.getId() + ': ' + String(err));
      }
    }
    // Images can arrive in Drive after a draft was created.
    // Recover the image queue later, without recreating or editing any Blogger post.
    try { backfillWaitingImageQueues_(folder,cfg); }
    catch(e){ console.error('Image queue recovery stopped: '+String(e.message||e).slice(0,150)); }
  } finally {
    lock.releaseLock();
  }
}

function bridgeConfig_() {
  const p = PropertiesService.getScriptProperties();
  const blogId = String(p.getProperty('BLOG_ID') || '').trim();
  const folderId = String(p.getProperty('INBOX_FOLDER_ID') || '').trim();
  if (!/^\d{8,24}$/.test(blogId)) throw new Error('BLOG_ID is missing or invalid');
  if (!/^[A-Za-z0-9_-]{15,128}$/.test(folderId))
    throw new Error('INBOX_FOLDER_ID is missing or invalid');
  return {blogId,folderId};
}

function parseAndValidate_(raw) {
  if (raw.length > 130000) throw new Error('Input document too large');
  const item = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!item || item.version !== 1 || item.blog !== 'byeol' ||
      item.publish !== false || item.mode !== 'draft_only')
    throw new Error('Wrong blog, missing draft-only flag, or unsupported schema');
  const title = String(item.title || '').trim();
  const label = String(item.label || '').trim();
  const description = String(item.description || '').trim();
  const slug = String(item.slug || '').replace(/\.html$/,'');
  const html = String(item.html || '').trim();
  const alt = String(item.alt || '').trim();
  const imageUrl = String(item.imageUrl || '').trim();
  if (title.length < 8 || title.length > 130 ||
      label !== '생활정보' ||
      description.length < 60 || description.length > 165 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      !alt || alt.length < 8 || alt.length > 160 ||
      html.length < 1300 || html.length > BRIDGE.maxHtmlChars ||
      !/<h2\b/i.test(html))
    throw new Error('Article title, label, meta, ALT, slug or HTML invalid');
  if (/<\s*(script|iframe|object|embed|form|h1)\b/i.test(html) ||
      /on(?:error|load|click|mouseover)\s*=/i.test(html) ||
      /(?:javascript:|data:image|srcdoc=)/i.test(html))
    throw new Error('Disallowed HTML or executable content');
  if (imageUrl) {
    // Apps Script V8 does not guarantee browser URL globals.
    const match = /^https:\/\/([a-z0-9.-]+)\//i.exec(imageUrl);
    if (!match) throw new Error('Invalid imageUrl');
    const host = match[1].toLowerCase();
    if (!(host === 'blogger.googleusercontent.com' ||
          host.endsWith('.googleusercontent.com') ||
          host === 'wiclab.github.io'))
      throw new Error('Image URL host not allowed');
    if (!html.includes(imageUrl)) throw new Error('Image URL missing from body HTML');
    if (!html.includes(alt.replace(/&/g,'&amp;')))
      throw new Error('ALT text must already be in body HTML');
  }
  return {title,label,description,slug,html,alt,imageUrl};
}

function verifyTargetBlog_(blogId) {
  const data = bloggerApi_(blogId, '?view=ADMIN','get');
  const url = String(data.url || '');
  if (url !== 'https://' + BRIDGE.host + '/' &&
      url !== 'http://' + BRIDGE.host + '/')
    throw new Error('OAuth Blogger account is not scoped to expected blog');
}

function draftAlreadyExists_(blogId, item) {
  for (const status of ['draft','live','scheduled']) {
    let token = '';
    const seen = {};
    for (let page = 0; page < BRIDGE.maxPages; page++) {
      let path = '/posts?view=ADMIN&status=' + status +
        '&maxResults=500&fetchBodies=false';
      if (token) path += '&pageToken=' + encodeURIComponent(token);
      const data = bloggerApi_(blogId,path,'get');
      for (const p of data.items || []) {
        if (String(p.title || '').trim() === item.title ||
            (p.url && String(p.url).endsWith('/' + item.slug + '.html'))) return true;
      }
      const next = String(data.nextPageToken || '');
      if (!next) break;
      if (seen[next]) throw new Error('Duplicate pagination token');
      seen[next] = true; token = next;
      if (page === BRIDGE.maxPages - 1) throw new Error('Posts list exceeded safe page cap');
    }
  }
  return false;
}

function bloggerApi_(blogId,suffix,method,data) {
  const base = 'https://www.googleapis.com/blogger/v3/blogs/' +
    encodeURIComponent(blogId);
  const options = {
    method:method,
    muteHttpExceptions:true,
    headers:{Authorization:'Bearer ' + ScriptApp.getOAuthToken()},
    contentType:'application/json',
  };
  if (data !== undefined) options.payload = JSON.stringify(data);
  const response = UrlFetchApp.fetch(base + suffix, options);
  const code = response.getResponseCode();
  if (code < 200 || code > 299) {
    let reasons = [];
    try {
      const error = JSON.parse(response.getContentText()).error || {};
      reasons = (error.errors || []).map(e => e.reason)
        .concat((error.details || []).map(e => e.reason))
        .filter(r => typeof r === 'string' && /^[A-Za-z0-9_]+$/.test(r));
    } catch (_) {}
    throw new Error('Blogger API HTTP ' + code + (reasons.length ? ' (' + reasons.join(',') + ')' : ''));
  }
  return JSON.parse(response.getContentText());
}

/** Read statuses for your own manual review; no mutation. */
function listDraftBridgeResults() {
  const p = PropertiesService.getScriptProperties().getProperties();
  Object.keys(p).filter(k => k.startsWith('draft:')).forEach(k =>
    console.log(k + ': ' + p[k]));
}


/**
 * Build a sidecar file for a user's own optional/occasionally-on PC.
 * The only output is a private Google Drive JSON file; this function
 * never uploads an image, publishes, updates, or creates a Blogger post.
 */
function prepareDraftImageQueue_(folder, sourceDoc, item, blogId, postId) {
  if (item.imageUrl) return {status:'SKIP_ALREADY_HOSTED'};
  const imageName = item.slug + '-featured.png';
  const matches = folder.getFilesByName(imageName);
  if (!matches.hasNext()) return {status:'WAITING_FOR_PNG',expected:imageName};
  const imageFile=matches.next();
  if (matches.hasNext()) throw new Error('Duplicate image name: '+imageName);
  if (imageFile.getMimeType() !== 'image/png' ||
      imageFile.getSize() < 1000 || imageFile.getSize() > 15*1024*1024)
    throw new Error('Invalid PNG image size or type');
  const fileName = 'READY_IMAGE__' + item.slug + '__' + postId + '.json';
  const already = folder.getFilesByName(fileName);
  if (already.hasNext()) return {status:'ALREADY_QUEUED',name:fileName};
  const body={
    version:1,task:'blogger_native_image',blog:'byeol',mode:'draft_only',publish:false,
    blogId:String(blogId),postId:String(postId),
    title:item.title,slug:item.slug,description:item.description,
    alt:item.alt,html:item.html,
    imageFileName:imageName,imageFileId:imageFile.getId(),
    sourceDocId:sourceDoc.getId()
  };
  folder.createFile(fileName, JSON.stringify(body), 'application/json');
  return {status:'QUEUED',name:fileName};
}

/**
 * Safe migration for articles saved before the sidecar feature was installed.
 * This does not recreate posts and does not change their content/status.
 */
function preparePendingImageQueues() {
  const cfg=bridgeConfig_();
  verifyTargetBlog_(cfg.blogId);
  const folder=DriveApp.getFolderById(cfg.folderId);
  const files=folder.getFilesByType(MimeType.GOOGLE_DOCS);
  const store=PropertiesService.getScriptProperties();
  let examined=0, queued=0;
  while(files.hasNext() && examined<100) {
    const file=files.next();
    if (!file.getName().startsWith('SAVED_NEEDS_SETTINGS__')) continue;
    const raw=store.getProperty('draft:'+file.getId());
    if (!raw) continue;
    const record=JSON.parse(raw);
    if (!record.postId || record.status!=='DRAFT_SAVED_NEEDS_SETTINGS') continue;
    examined++;
    const checked=bloggerApi_(cfg.blogId,
      '/posts/'+encodeURIComponent(record.postId)+'?view=ADMIN','get');
    if (!checked || String(checked.status).toUpperCase()!=='DRAFT')
      continue;
    const item=parseAndValidate_(DocumentApp.openById(file.getId()).getBody().getText());
    if (checked.title!==item.title) continue;
    const q=prepareDraftImageQueue_(folder,file,item,cfg.blogId,record.postId);
    if(q.status==='QUEUED')queued++;
    console.log(JSON.stringify({docId:file.getId(),queue:q.status}));
  }
  console.log(JSON.stringify({examined,queued}));
}


/** Recover PNG files uploaded after the initial draft was saved; max 5 per tick. */
function backfillWaitingImageQueues_(folder,cfg) {
  const store=PropertiesService.getScriptProperties();
  const entries=store.getProperties();
  let attempts=0;
  for (const key of Object.keys(entries)) {
    if (!key.startsWith('draft:') || attempts>=5) continue;
    let record;
    try {record=JSON.parse(entries[key]);}catch(_){continue;}
    if (!record || record.status!=='DRAFT_SAVED_NEEDS_SETTINGS' ||
      record.imageQueue!=='WAITING_FOR_PNG' || !record.postId ||
      !/^[a-z0-9-]+-featured\.png$/.test(String(record.imageName||''))) continue;
    const found=folder.getFilesByName(record.imageName);
    if(!found.hasNext())continue;
    attempts++;
    try {
      const doc=DriveApp.getFileById(key.slice('draft:'.length));
      if(!doc.getName().startsWith('SAVED_NEEDS_SETTINGS__')) continue;
      const item=parseAndValidate_(DocumentApp.openById(doc.getId()).getBody().getText());
      const existing=bloggerApi_(cfg.blogId,'/posts/'+encodeURIComponent(record.postId)+
        '?view=ADMIN','get');
      if(!existing || String(existing.status).toUpperCase()!=='DRAFT' ||
         existing.title!==item.title)throw Error('Draft changed before sidecar creation');
      const queue=prepareDraftImageQueue_(folder,doc,item,cfg.blogId,record.postId);
      record.imageQueue=queue.status;
      store.setProperty(key,JSON.stringify(record));
      console.log(JSON.stringify({docId:doc.getId(),imageQueue:queue.status}));
    }catch(e) {
      // No retry of Blogger post creation; this is only a local image queue.
      console.error('Image queue backfill error for '+key.slice(6)+': '+
        String(e.message||e).slice(0,120));
    }
  }
}
