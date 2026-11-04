// Real isolated local Worker routes + SQLite. No FCM credentials or external push calls.
import assert from 'node:assert/strict';
const base = new URL(process.env.TEST_BASE_URL || 'http://127.0.0.1:8787');
assert.ok(base.protocol === 'http:' && ['127.0.0.1','localhost'].includes(base.hostname));
async function call(path, body, status = 200, key = true) {
  const response = await fetch(new URL(path,base), { method:body===undefined?'GET':'POST',redirect:'error',headers:{...(key?{'x-web-key':'test-web-key'}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000) });
  assert.equal(response.status,status,path); return status === 401 ? response.text() : response.json();
}
const prefix='/web/push/native/';
await call(prefix+'subscribe',{token:'http-fixture'},401,false);
await call(prefix+'subscribe',{token:'bad\ntoken'},400);
await call(prefix+'unsubscribe',{token:{}},400);
assert.equal((await call('/web/push')).devices,0,'fresh isolated Worker');
assert.equal((await call(prefix+'subscribe',{token:'http-fixture'})).devices,1);
assert.equal((await call(prefix+'subscribe',{token:'http-fixture'})).devices,1);
assert.equal((await call(prefix+'subscribe',{token:'http-fixture-new',previousToken:'http-fixture'})).devices,1);
assert.deepEqual(await call('/web/push/test',{}),{sent:0,failed:[]},'no FCM secret skips safely');
await call('/web/residents',{id:'native-fixture',name:'Native fixture'});
assert.equal((await call('/r/native-fixture/web/push')).devices,1);
assert.equal((await call('/r/native-fixture'+prefix+'subscribe',{token:'second-fixture'})).devices,2);
assert.equal((await call('/web/push')).devices,2);
assert.equal((await call('/r/native-fixture'+prefix+'unsubscribe',{token:'http-fixture-new'})).devices,1);
assert.equal((await call(prefix+'unsubscribe',{token:'second-fixture'})).devices,0);
console.log('Native push Worker routes: passed (auth, validation, deduplication, rotation, shared residents, missing secret, unregister).');
