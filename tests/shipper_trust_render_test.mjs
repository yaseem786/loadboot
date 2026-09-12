import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../app/partner/shipper-trust.js',import.meta.url),'utf8');
class Element {
  constructor(text=''){this.text=text;this.children=[];this.attrs={};}
  appendChild(e){this.children.push(e);return e;}
  setAttribute(k,v){this.attrs[k]=v;}
  set innerHTML(s){this.text=s;this.children=[];}
  get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}
}
for(const [value,label] of [[true,'Yes'],[false,'No'],[null,'Not checked'],[undefined,'Not checked']]) {
  test('actual shipper view renders MX '+String(value)+' as '+label,async()=>{
    const context=vm.createContext({document:{createElement:()=>new Element(),createTextNode:t=>new Element(t)},setInterval:()=>{throw Error('unexpected polling');},clearInterval(){}});
    const mod=new vm.SourceTextModule(source,{context});
    await mod.link(async spec=>{
      const exports=spec.endsWith('api.js') ? {
        partnerShipperStatus:async()=>({tier:'business_verified',can_post:true,check:{mx:value},packet:[]}),
        partnerShipperVerify:()=>assert.fail('must not verify'),partnerShipperCompanyEmail:()=>assert.fail('must not email'),partnerVerifyCode:()=>assert.fail('must not verify code')
      } : {ensureCss(){},decorateCards(){},progressRing:()=>new Element()};
      return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context});
    });await mod.evaluate();
    const host=new Element();const view=mod.namespace.mountShipperTrust(host);await view.refresh();
    assert.ok(host.textContent.includes('Receives mail'+label));
    assert.ok(host.textContent.includes('Company-domain check passed'));
    const badge=mod.namespace.shipperBadge({tier:'business_verified'});
    assert.equal(badge.textContent,'✓ Company-domain check passed');
    assert.match(badge.attrs.title,/do not establish creditworthiness/);
    assert.equal(mod.namespace.shipperBadge({tier:'verified'}).textContent,'✓ Onboarding reviewed');
    view.stop();
  });
}
