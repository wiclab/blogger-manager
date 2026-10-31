import process from "node:process";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const bucket = "byeolsemso-images";
if (!accountId || !apiToken) {
  console.error("Cloudflare API token or account ID is missing.");
  process.exit(1);
}
const root = "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(accountId) + "/r2/buckets";
const headers = {Authorization:"Bearer "+apiToken,"Content-Type":"application/json"};
async function cf(url, options = {}) {
  const response = await fetch(url,{...options,headers});
  const body = await response.json().catch(()=>({}));
  return {status:response.status,success:body.success===true,errors:(body.errors||[]).map(e=>String(e.message||e.code)).slice(0,3)};
}
const existing = await cf(root+"/"+bucket);
if(existing.success) {
  console.log("R2 bucket already exists: "+bucket);
  process.exit(0);
}
if(existing.status!==404) {
  console.error("Cannot check R2 bucket ("+existing.status+"): "+existing.errors.join("; "));
  process.exit(1);
}
const created = await cf(root, {method:"POST",body:JSON.stringify({name:bucket})});
if(!created.success){
  console.error("Could not create R2 bucket ("+created.status+"): "+created.errors.join("; "));
  process.exit(1);
}
console.log("R2 bucket created: "+bucket);
