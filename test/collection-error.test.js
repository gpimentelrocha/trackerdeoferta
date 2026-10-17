import test from 'node:test';
import assert from 'node:assert/strict';
import { CollectionError, collectionFailure, reportCollectionFailure } from '../src/collection-error.js';

test('falhas da coleta distinguem navegador, certificado, DNS, proxy, HTTP e timeout sem expor a URL', () => {
  const sensitive = 'https://www.facebook.com/ads/library/?q=private-value';
  const cases = [
    ['browser_setup',new Error('ENOENT '+sensitive),0,'BROWSER_SETUP_FAILED'],
    ['browser_launch',new Error('launch failed '+sensitive),0,'BROWSER_START_FAILED'],
    ['navigation',new Error('page.goto: net::ERR_CERT_AUTHORITY_INVALID at '+sensitive),0,'FACEBOOK_TLS_FAILED'],
    ['navigation',new Error('net::ERR_NAME_NOT_RESOLVED at '+sensitive),0,'FACEBOOK_DNS_FAILED'],
    ['navigation',new Error('net::ERR_TUNNEL_CONNECTION_FAILED at '+sensitive),0,'FACEBOOK_PROXY_FAILED'],
    ['navigation',new Error('net::ERR_HTTP_RESPONSE_CODE_FAILURE at '+sensitive),403,'FACEBOOK_HTTP_FAILED'],
    ['navigation',Object.assign(new Error('page.goto timed out '+sensitive),{name:'TimeoutError'}),0,'FACEBOOK_TIMEOUT'],
    ['count',new Error('Target page, context or browser has been closed '+sensitive),200,'BROWSER_CLOSED'],
    ['navigation',new Error('net::ERR_CONNECTION_RESET at '+sensitive),0,'FACEBOOK_CONNECTION_FAILED']
  ];
  for (const [stage,error,httpStatus,code] of cases) {
    const failure=collectionFailure(error,{stage,httpStatus});
    assert.ok(failure instanceof CollectionError);
    assert.equal(failure.code,code);
    assert.match(failure.message,/última contagem foi preservada/);
    assert.ok(!failure.message.includes(sensitive));
    assert.ok(!failure.message.includes('private-value'));
  }
});

test('falhas reconhecidas e logs preservam apenas os campos seguros do diagnóstico', t => {
  const error=new CollectionError('Acesso restrito.','FACEBOOK_ACCESS_RESTRICTED');
  assert.equal(collectionFailure(error,{stage:'count',httpStatus:403}),error);
  const calls=[];
  t.mock.method(console,'error',(...args)=>calls.push(args));
  reportCollectionFailure(error,{stage:'count',httpStatus:403});
  assert.deepEqual(calls,[['[tracker:collection]',{code:'FACEBOOK_ACCESS_RESTRICTED',stage:'count',httpStatus:403}]]);
});
