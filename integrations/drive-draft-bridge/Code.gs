/**
 * ChatGPT -> private Google Drive document -> Blogger DRAFT ONLY.
 * Runs under the blog owner's own Google Apps Script OAuth authorization.
 * Only explicit image cleanup requests can PATCH existing draft HTML.
 * No publishing, deletion, new unauthorised drafts or outside token storage.
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
    // Explicit user request only: after they upload a PNG in Blogger and save.
    // The request document must be created by ChatGPT in the private queue.
    try { processImageCleanupInbox_(folder,cfg); }
    catch(e){ console.error('Image cleanup inbox stopped: '+String(e.message||e).slice(0,150)); }
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
    try {
      const checked=bloggerApi_(cfg.blogId,
        '/posts/'+encodeURIComponent(record.postId)+'?view=ADMIN','get');
      if (!checked || String(checked.status).toUpperCase()!=='DRAFT')
        continue;
      const item=parseAndValidate_(DocumentApp.openById(file.getId()).getBody().getText());
      if (checked.title!==item.title) continue;
      const q=prepareDraftImageQueue_(folder,file,item,cfg.blogId,record.postId);
      if(q.status==='QUEUED')queued++;
      console.log(JSON.stringify({docId:file.getId(),queue:q.status}));
    } catch(e) {
      // A user may have deleted an older draft. Never resurrect it or stop
      // processing unrelated valid drafts in the queue.
      console.error('Skipping old/invalid draft '+file.getId()+': '+
        String(e.message||e).slice(0,130));
    }
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


/**
 * User-controlled image HTML tidy-up, no image binary upload.
 * The user first uses the native Blogger editor to upload exactly one image
 * and saves the post as a DRAFT. ChatGPT then adds one private Drive Google Doc:
 *  name "READY_CLEANUP__<sourceDocId>"
 *  body {"version":1,"action":"tidy_uploaded_blogger_image","blog":"byeol",
 *        "publish":false,"mode":"draft_only","sourceDocId":"..."}
 *
 * This code never calls Blogger publish, insert, delete or revert endpoints.
 * It updates only the content field of one previously verified DRAFT via PATCH.
 */
function processImageCleanupInbox_(folder,cfg) {
  const files=folder.getFilesByType(MimeType.GOOGLE_DOCS);
  const store=PropertiesService.getScriptProperties();
  let count=0;
  while(files.hasNext() && count<3) {
    const requestFile=files.next();
    if(!requestFile.getName().startsWith('READY_CLEANUP__'))continue;
    count++;
    const key='tidy:'+requestFile.getId();
    if(store.getProperty(key))continue; // one shot even on ambiguous network result
    let attemptedPatch=false;
    try {
      const raw=DocumentApp.openById(requestFile.getId()).getBody().getText();
      const request=JSON.parse(String(raw).replace(/^\uFEFF/,''));
      if(request.version!==1 || request.action!=='tidy_uploaded_blogger_image' ||
         request.blog!=='byeol' || request.publish!==false ||
         request.mode!=='draft_only' ||
         !/^[a-zA-Z0-9_-]{20,128}$/.test(String(request.sourceDocId||'')) ||
         requestFile.getName()!=='READY_CLEANUP__'+request.sourceDocId)
        throw new Error('Cleanup request schema/name mismatch');
      const source=DriveApp.getFileById(request.sourceDocId);
      if(!source.getName().startsWith('SAVED_NEEDS_SETTINGS__'))
        throw new Error('Source is not a recorded saved draft');
      const parents=source.getParents();
      let inFolder=false;
      while(parents.hasNext())if(parents.next().getId()===cfg.folderId)inFolder=true;
      if(!inFolder)throw new Error('Source draft document not in approved folder');
      const stateString=store.getProperty('draft:'+request.sourceDocId);
      const state=stateString?JSON.parse(stateString):null;
      if(!state || state.status!=='DRAFT_SAVED_NEEDS_SETTINGS' ||
         !/^\d{8,24}$/.test(String(state.postId||'')))
        throw new Error('No approved Blogger draft ID associated with source');
      const original=parseAndValidate_(
        DocumentApp.openById(source.getId()).getBody().getText());
      const postPath='/posts/'+encodeURIComponent(state.postId)+'?view=ADMIN';
      const before=bloggerApi_(cfg.blogId,postPath,'get');
      if(!before || String(before.id)!==state.postId ||
        String(before.status).toUpperCase()!=='DRAFT' ||
        before.title!==original.title)
        throw new Error('Blogger post ID, title or DRAFT state mismatch');
      const imageSource=String(before.content||'');
      const tidy=normalizeUploadedImageHtml_(imageSource,original.alt,original.html);
      // Re-read immediately before PATCH to prevent editing a different revision.
      const rechecked=bloggerApi_(cfg.blogId,postPath,'get');
      if(!rechecked || rechecked.content!==before.content ||
         String(rechecked.status).toUpperCase()!=='DRAFT' ||
         rechecked.title!==original.title)
        throw new Error('Blogger draft changed while preparing cleanup');
      store.setProperty(key,JSON.stringify({
        status:'PATCH_IN_FLIGHT',sourceDocId:request.sourceDocId,
        postId:state.postId,at:new Date().toISOString()}));
      attemptedPatch=true;
      // POST /publish is never used; the only write is a content-only PATCH.
      bloggerApi_(cfg.blogId,'/posts/'+encodeURIComponent(state.postId),
        'patch',{content:tidy.html});
      const result=bloggerApi_(cfg.blogId,postPath,'get');
      const persisted=String(result && result.content || '');
      const persistedImage=/<img\b[^>]*>/i.exec(persisted);
      if(!result || String(result.status).toUpperCase()!=='DRAFT' ||
         result.title!==original.title || !persistedImage ||
         !persistedImage[0].includes('alt="'+escapeHtmlAttr_(original.alt)+'"') ||
         !persistedImage[0].includes(tidy.imageUrl) ||
         !/max-width\s*:\s*100%/i.test(persistedImage[0]) ||
         persisted.indexOf(persistedImage[0]) > persisted.indexOf('<h2') ||
         imageFingerprint_(persisted)!==imageFingerprint_(imageSource))
        throw new Error('Blogger draft image/ALT/content read-back verification failed');
      state.needsImageUpload=false;
      state.imageUrl=tidy.imageUrl;
      state.imageQueue='SKIP_MANUALLY_UPLOADED';
      state.imageCleanedAt=new Date().toISOString();
      store.setProperty('draft:'+request.sourceDocId,JSON.stringify(state));
      const record={
        status:'IMAGE_CLEANED',postId:state.postId,
        imageUrl:tidy.imageUrl,
        editUrl:'https://www.blogger.com/blog/post/edit/'+cfg.blogId+'/'+state.postId,
        at:new Date().toISOString()};
      store.setProperty(key,JSON.stringify(record));
      requestFile.setName('DONE_CLEANUP__'+request.sourceDocId);
      // If the optional PC image queue exists, disable it after manual upload.
      // Leaving an unused PNG in Drive is fine; never delete user files.
      try {
        const pcQueueName='READY_IMAGE__'+original.slug+'__'+state.postId+'.json';
        const pcQueue=folder.getFilesByName(pcQueueName);
        while(pcQueue.hasNext()) {
          pcQueue.next().setName('SKIP_IMAGE__'+original.slug+'__'+state.postId+'.json');
        }
      }catch(queueErr){console.error('Optional PC queue rename skipped: '+
        String(queueErr.message||queueErr).slice(0,80));}
      console.log(JSON.stringify({cleanupDoc:requestFile.getId(),...record}));
    }catch(e){
      // A failed/ambiguous PATCH can have changed Blogger: NEVER auto-retry.
      const result={
        status:'REVIEW_IMAGE_CLEANUP',attemptedPatch,
        reason:String(e.message||e).slice(0,180),
        at:new Date().toISOString()
      };
      store.setProperty(key,JSON.stringify(result));
      try {requestFile.setName('REVIEW_CLEANUP__'+
        requestFile.getName().replace(/^READY_CLEANUP__/,'').replace(/^REVIEW_CLEANUP__/,''));}
      catch(_){}
      console.error(JSON.stringify({cleanupDoc:requestFile.getId(),...result}));
    }
  }
}

/** Image-only HTML adjustment. No rewriting of headings, links or paragraphs. */
function normalizeUploadedImageHtml_(html,alt,baselineHtml){
  if(/<img\b/i.test(baselineHtml))
    throw new Error('Original draft already contained an image; refusing ambiguous cleanup');
  const tags=Array.from(html.matchAll(/<img\b[^>]*>/gi));
  if(tags.length!==1)
    throw new Error('Expected exactly one newly uploaded image in Blogger draft');
  const img=tags[0];
  const source=(/\bsrc\s*=\s*["']([^"']+)["']/i.exec(img[0])||[])[1]||'';
  if(!/^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\/[^\s"'<>]+$/i.test(source))
    throw new Error('Image is not on the official Google-hosted Blogger domain');
  if(imageFingerprint_(html)!==imageFingerprint_(baselineHtml))
    throw new Error('Body text differs from the original saved draft; preserve user edits');
  if(!/<h2\b/i.test(html))
    throw new Error('Expected H2 headings are missing');
  // Preserve all non-image hyperlinks (official sources/internal links).
  const originalHrefs=imageNonImageHrefs_(baselineHtml);
  const currentHrefs=imageNonImageHrefs_(html);
  if(originalHrefs.join('\n')!==currentHrefs.join('\n'))
    throw new Error('Non-image links changed; no automatic overwrite');

  let start=img.index,end=img.index+img[0].length;
  let left=html.slice(0,start),right=html.slice(end);
  const anchor=/<a\b[^>]*>\s*$/i.exec(left);
  const anchorEnd=/^\s*<\/a>/i.exec(right);
  if((anchor&&!anchorEnd)||(!anchor&&anchorEnd))
    throw new Error('Image anchor wrapper cannot be verified');
  if(anchor&&anchorEnd) {
    const href=(/\bhref\s*=\s*["']([^"']+)["']/i.exec(anchor[0])||[])[1]||'';
    if(href&&!/^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\//i.test(href))
      throw new Error('Non-Google image anchor URL; refusing to remove');
    start-=anchor[0].length;
    end+=anchorEnd[0].length;
    left=html.slice(0,start);right=html.slice(end);
  }
  // Remove up to two empty presentation wrappers around only this image,
  // never a wrapper that contains text or other elements.
  for(let i=0;i<2;i++){
    const opening=/<(div|figure|p)\b[^>]*>\s*$/i.exec(left);
    if(!opening)break;
    const close=new RegExp('^\\s*<\\/'+opening[1]+'\\s*>','i').exec(right);
    if(!close)break;
    start-=opening[0].length;end+=close[0].length;
    left=html.slice(0,start);right=html.slice(end);
  }
  const remaining=html.slice(0,start)+html.slice(end);
  const canonical='<div class="separator" data-byeol-featured="1" '+
    'style="clear:both;display:block;box-sizing:border-box;width:100%;'+
    'max-width:900px;text-align:center;margin:0 auto 24px;">'+
    '<img src="'+escapeHtmlAttr_(source)+'" alt="'+escapeHtmlAttr_(alt)+'" '+
    'loading="eager" decoding="async" style="display:block;box-sizing:border-box;'+
    'width:100%;max-width:100%;height:auto;margin:0 auto;'+
    'border:0;border-radius:12px;" />'+
    '</div>';
  const lead=/^(\s*<article\b[^>]*>)/i.exec(remaining);
  const output=lead?remaining.slice(0,lead[0].length)+'\n'+canonical+'\n'+
    remaining.slice(lead[0].length):canonical+'\n'+remaining;
  if((output.match(/<img\b/gi)||[]).length!==1 ||
     imageFingerprint_(output)!==imageFingerprint_(html))
    throw new Error('Image cleanup would change the article text');
  return {html:output,imageUrl:source};
}
function escapeHtmlAttr_(text){
  return String(text).replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
}
function imageFingerprint_(html){
  return String(html).replace(/<!--[\s\S]*?-->/g,'')
    .replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/gi,' ')
    .replace(/\s+/g,'').trim();
}
function imageNonImageHrefs_(html){
  return Array.from(String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi))
    .map(m=>m[1]).filter(h=>!/^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\//i.test(h))
    .sort();
}
