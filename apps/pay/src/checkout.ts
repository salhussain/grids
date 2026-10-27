import { surchargeFor, type MethodDto, type PayMethod } from '@grids/schema';

/** What the payment page shows. */
export interface CheckoutInfo {
  amount: number;
  currency: string;
  description: string;
  status: string;
  merchant: { id: string; name: string; logo: string | null; mode: 'test' | 'live'; methods: MethodDto[] } | null;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const ICON: Record<PayMethod, string> = {
  card: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  bank: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/></svg>',
  instalments: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

const STYLE = String.raw`*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f4f4f4;color:#161616;display:grid;place-items:start center;min-height:100vh;margin:0;padding:32px 16px}main{background:#fff;max-width:460px;width:100%;padding:28px;border-top:4px solid #8a1f4a;box-shadow:0 1px 3px rgba(0,0,0,.12)}small{color:#6f6f6f}small.test{display:block;margin-bottom:14px;letter-spacing:.06em;font-size:11px;color:#b45309}.who{display:flex;gap:12px;align-items:center}.logo{width:44px;height:44px;object-fit:contain;border:1px solid #e0e0e0;flex:none}.mono{display:grid;place-items:center;background:#8a1f4a;color:#fff;font-weight:700}.sum{margin:18px 0;border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;padding:10px 0;font-size:14px}.sum div{display:flex;justify-content:space-between;padding:3px 0;color:#525252}.sum .total{color:#161616;font-size:20px;font-weight:600;padding-top:8px}.opt{border:1px solid #c6c6c6;margin-bottom:8px;background:#fff}.opt.on{border-color:#8a1f4a;box-shadow:inset 3px 0 0 #8a1f4a}.optbtn{display:flex;align-items:center;gap:12px;width:100%;padding:12px;background:none;border:0;font:inherit;cursor:pointer;text-align:start}.radio{width:18px;height:18px;border-radius:50%;border:2px solid #8d8d8d;flex:none;display:grid;place-items:center}.opt.on .radio{border-color:#8a1f4a}.opt.on .radio::after{content:'';width:8px;height:8px;border-radius:50%;background:#8a1f4a}.optbtn b{display:block;font-size:14px}.optbtn small{font-size:12px}.optmark{flex:none;display:grid;place-items:center;width:24px}.badge{margin-inline-start:auto;font-size:11px;font-weight:600;color:#525252;background:#f0f0f0;padding:2px 7px;white-space:nowrap}.badge.fee{color:#8a4b00;background:#fdf1d6}.panel{display:none;padding:0 14px 14px}.opt.on .panel{display:block}label{display:block;font-size:12px;color:#525252;margin-bottom:12px;position:relative}input,select{display:block;width:100%;margin-top:4px;padding:10px;border:1px solid #c6c6c6;font:inherit;font-size:15px;background:#fff}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pay{width:100%;padding:12px;background:#8a1f4a;color:#fff;border:0;font:inherit;font-weight:600;cursor:pointer}.pay[disabled]{opacity:.6}.alt{width:100%;padding:11px;background:#fff;color:#8a1f4a;border:1px solid #8a1f4a;font:inherit;font-weight:600;cursor:pointer;margin-top:8px}.cancel{display:block;text-align:center;margin-top:14px;color:#8a1f4a;font-size:14px}.brand{position:absolute;right:0;top:0;font-size:12px;font-weight:700;color:#8a1f4a}small.fe{display:block;color:#da1e28;min-height:16px;margin-top:3px;font-size:12px}input.bad{border-color:#da1e28}.err{color:#da1e28;font-size:13px;min-height:18px;margin:0 0 8px}.note{font-size:12px;color:#6f6f6f;margin:12px 0 0}.plan{border:1px solid #e0e0e0;padding:12px;margin-bottom:14px;font-size:14px}.plan div{display:flex;justify-content:space-between;padding:3px 0}.bank{border:1px dashed #8a1f4a;padding:14px;margin-top:12px;display:none}.bank.on{display:block}.spin{display:none;text-align:center;padding:18px 0;color:#525252}.spin.on{display:block}`;

const SCRIPT = String.raw`
const main=document.querySelector('main');const id=main.dataset.id;const cur=main.dataset.currency;const base=+main.dataset.amount;
const fmt=v=>new Intl.NumberFormat('en-GB',{style:'currency',currency:cur}).format(v/100);
const post=async(path,body)=>{const r=await fetch('/pay/'+id+'/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return r.json().catch(()=>({}))};
const done=j=>{if(j.ok||(j.final&&j.returnUrl)){location.href=j.returnUrl||'about:blank';return true}return false};
const digits=v=>v.replace(/\D/g,'');
const opts=[...document.querySelectorAll('.opt')];
const select=k=>{const o=opts.find(x=>x.dataset.method===k)||opts[0];if(!o)return;
opts.forEach(x=>x.classList.toggle('on',x===o));
const sur=+o.dataset.sur,total=base+sur;
document.getElementById('s-sur-row').style.display=sur?'flex':'none';
document.getElementById('s-sur-name').textContent=o.dataset.name+' fee';
document.getElementById('s-sur').textContent='+'+fmt(sur);
document.getElementById('s-total').textContent=fmt(total);
o.querySelectorAll('.paylabel').forEach(l=>{l.textContent=l.dataset.kind==='first'?'Pay '+fmt(Math.ceil(total/+o.dataset.n))+' today':'Pay '+fmt(total)});
const plan=o.querySelector('.plan');if(plan){const n=+o.dataset.n,q=Math.ceil(total/n);plan.innerHTML=Array.from({length:n},(_,i)=>'<div><span>'+(i===0?'Today':'In '+i*2+' weeks')+'</span><b>'+fmt(i===n-1?Math.max(0,total-q*(n-1)):q)+'</b></div>').join('')}};
opts.forEach(o=>{const b=o.querySelector('.optbtn');if(b&&opts.length>1)b.addEventListener('click',()=>select(o.dataset.method))});
select(opts[0]?.dataset.method);

function initCard(panel,key){
const f=panel.querySelector('form');if(!f)return;
const err=t=>{panel.querySelector('.err').textContent=t||''};
const $=n=>f.querySelector('[name='+n+']');
const fe=n=>f.querySelector('.fe[data-for='+n+']');
const brand=f.querySelector('.brand');
const brandOf=n=>/^4/.test(n)?'Visa':/^(5[1-5]|2(22[1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/.test(n)?'Mastercard':/^3[47]/.test(n)?'Amex':/^(6011|65)/.test(n)?'Discover':'';
const luhn=n=>{let s=0,alt=false;for(let i=n.length-1;i>=0;i--){let d=+n[i];if(alt){d*=2;if(d>9)d-=9}s+=d;alt=!alt}return s%10===0};
$('number').addEventListener('input',e=>{const b=brandOf(digits(e.target.value));const d=digits(e.target.value).slice(0,b==='Amex'?15:16);e.target.value=b==='Amex'?[d.slice(0,4),d.slice(4,10),d.slice(10)].filter(Boolean).join(' '):d.replace(/(.{4})/g,'$1 ').trim();brand.textContent=b;});
$('expiry').addEventListener('input',e=>{let d=digits(e.target.value).slice(0,4);if(d.length===1&&+d>1)d='0'+d;e.target.value=d.length>2?d.slice(0,2)+' / '+d.slice(2):d;});
$('cvc').addEventListener('input',e=>{e.target.value=digits(e.target.value).slice(0,brandOf(digits($('number').value))==='Amex'?4:3);});
const check={
name:()=>$('name').value.trim().length<2?'Enter the name on the card':'',
number:()=>{const n=digits($('number').value);return n.length<13||!luhn(n)?'Enter a valid card number':''},
expiry:()=>{const m=$('expiry').value.match(/^(\d{2}) \/ (\d{2})$/);if(!m||+m[1]<1||+m[1]>12)return 'Enter the expiry as MM / YY';const now=new Date();const y=2000+ +m[2];return y<now.getFullYear()||(y===now.getFullYear()&&+m[1]<now.getMonth()+1)?'This card has expired':''},
cvc:()=>{const need=brandOf(digits($('number').value))==='Amex'?4:3;return digits($('cvc').value).length!==need?'Enter the '+need+'-digit security code':''}
};
const showErr=n=>{const m=check[n]();fe(n).textContent=m;$(n).classList.toggle('bad',!!m);return !m};
Object.keys(check).forEach(n=>{$(n).addEventListener('blur',()=>showErr(n));$(n).addEventListener('input',()=>{if($(n).classList.contains('bad'))showErr(n)})});
f.addEventListener('submit',async e=>{e.preventDefault();err('');
if(!Object.keys(check).map(showErr).every(Boolean))return;
const btn=f.querySelector('.pay');btn.disabled=true;
const j=await post('pay',{...Object.fromEntries(new FormData(f)),method:key});
if(done(j))return;
err(j.message||'The payment could not be taken.');btn.disabled=false;$('number').value='';$('number').focus();});
}

function initWallet(panel,key){
const w=panel.querySelector('form');if(!w)return;
const err=t=>{panel.querySelector('.err').textContent=t||''};
w.addEventListener('submit',async e=>{e.preventDefault();err('');
const phone=digits(w.querySelector('[name=phone]').value);
if(phone.length<7||phone.length>13){err('Enter your mobile number with the country code');return}
const btn=w.querySelector('.pay');btn.disabled=true;w.querySelector('.spin').classList.add('on');
await new Promise(r=>setTimeout(r,1800));
const j=await post('wallet',{method:key,phone});
if(done(j))return;
w.querySelector('.spin').classList.remove('on');err(j.message||'The payment was not approved.');btn.disabled=false;});
}

function initBank(panel,key){
const b=panel.querySelector('form');if(!b)return;
const err=t=>{panel.querySelector('.err').textContent=t||''};
const bankBox=b.querySelector('.bank');
b.addEventListener('submit',e=>{e.preventDefault();err('');bankBox.classList.add('on');b.querySelector('.pay').style.display='none';b.querySelector('select').disabled=true;bankBox.querySelector('b').textContent=b.querySelector('select').value;});
bankBox.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',async()=>{bankBox.querySelectorAll('button').forEach(x=>x.disabled=true);
const j=await post('bank',{method:key,bank:b.querySelector('select').value,approve:btn.dataset.approve==='1'});
if(done(j))return;
err(j.message||'The bank did not approve the payment.');bankBox.classList.remove('on');b.querySelector('.pay').style.display='';b.querySelector('select').disabled=false;bankBox.querySelectorAll('button').forEach(x=>x.disabled=false);}));
}

function initInstalments(panel,key){
const i=panel.querySelector('form');if(!i)return;
const err=t=>{panel.querySelector('.err').textContent=t||''};
i.addEventListener('submit',async e=>{e.preventDefault();err('');
const d=Object.fromEntries(new FormData(i));
if(d.name.trim().length<2||!/^\S+@\S+\.\S+$/.test(d.email.trim())){err('Enter your name and a valid email address');return}
if(!i.querySelector('[name=agree]').checked){err('Agree to the instalment plan to continue');return}
const btn=i.querySelector('.pay');btn.disabled=true;
const j=await post('instalments',{method:key,name:d.name,email:d.email,agree:true});
if(done(j))return;
err(j.message||'The instalment plan was not approved.');btn.disabled=false;});
}

const INIT={card:initCard,wallet:initWallet,bank:initBank,instalments:initInstalments};
opts.forEach(o=>INIT[o.dataset.kind]&&INIT[o.dataset.kind](o,o.dataset.method));
`;

/** The payment page: how to pay (when the merchant offers several ways), then the form for that way. Test mode only pretends. */
export function renderCheckout(p: CheckoutInfo, id: string): string {
  const money = (minor: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: p.currency }).format(minor / 100);
  const logo = (src: string | null, name: string) =>
    src && /^data:image\/(png|jpeg|webp|svg\+xml|gif);/.test(src) ? `<img src="${esc(src)}" alt="" class="logo">` : `<span class="logo mono">${esc(name.slice(0, 1).toUpperCase())}</span>`;
  const m = p.merchant;
  const test = m?.mode !== 'live';
  let body: string;
  if (p.status !== 'pending') body = `<p>This payment has already ended (${esc(p.status)}). You can close this page.</p>`;
  else if (!m || !m.methods.length) body = '<p>This payment can’t be taken right now. Go back and try again.</p>';
  else {
    const form = (k: MethodDto, total: number): string => {
      const label = `<span class="paylabel" data-kind="${k.kind === 'instalments' ? 'first' : 'all'}">Pay ${esc(money(total))}</span>`;
      switch (k.kind) {
        case 'card':
          return `<form autocomplete="off" novalidate>
<label>Name on card<input name="name" autocomplete="cc-name" maxlength="60"><small class="fe" data-for="name"></small></label>
<label>Card number<span class="brand"></span><input name="number" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23"><small class="fe" data-for="number"></small></label>
<div class="row"><label>Expiry<input name="expiry" inputmode="numeric" placeholder="MM / YY" autocomplete="cc-exp" maxlength="7"><small class="fe" data-for="expiry"></small></label><label>CVC<input name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"><small class="fe" data-for="cvc"></small></label></div>
<p class="err" role="alert"></p><button class="pay" type="submit">${label}</button></form>
<p class="note">${test ? 'Test cards: 4242 4242 4242 4242 pays; 4000 0000 0000 0002 is declined. Any future expiry and any CVC.' : 'Payments are processed securely by GridPay.'}</p>`;
        case 'wallet':
          return `<form autocomplete="off" novalidate>
<label>Mobile number<input name="phone" inputmode="tel" autocomplete="tel" placeholder="+679 700 0000"></label>
<p class="spin">Approve the payment on your phone…</p>
<p class="err" role="alert"></p><button class="pay" type="submit">${label}</button></form>
<p class="note">${test ? 'Test: any number works; one ending in 0000 is declined.' : 'You will get a request on your phone to approve.'}</p>`;
        case 'bank':
          return `<form autocomplete="off" novalidate>
<label>Your bank<select name="bank"><option>Demo Bank</option><option>Test Credit Union</option><option>Sample Savings</option></select></label>
<p class="err" role="alert"></p><button class="pay" type="submit">Continue to your bank</button>
<div class="bank"><b></b><p>Approve a payment to ${esc(m.name)}?</p><button class="pay" type="button" data-approve="1">Approve</button><button class="alt" type="button" data-approve="0">Decline</button></div></form>
<p class="note">${test ? 'Test: this pretends to be your bank’s approval page.' : 'You will approve the payment in your own bank.'}</p>`;
        case 'instalments':
          return `<form autocomplete="off" novalidate>
<div class="plan"></div>
<label>Name<input name="name" autocomplete="name" maxlength="80"></label>
<label>Email<input name="email" type="email" autocomplete="email" maxlength="120"></label>
<label style="display:flex;gap:8px;align-items:flex-start"><input name="agree" type="checkbox" style="width:auto;margin-top:2px"> I agree to pay the remaining instalments on these dates.</label>
<p class="err" role="alert"></p><button class="pay" type="submit">${label}</button></form>
<p class="note">${test ? 'Test: nothing is charged and no later instalments are collected.' : 'Later instalments are collected automatically.'}</p>`;
      }
    };
    const many = m.methods.length > 1;
    const opts = m.methods
      .map((k) => {
        const sur = surchargeFor(p.amount, k);
        const badge = sur > 0 ? `<span class="badge fee">+${esc(money(sur))}${k.surchargePercent > 0 ? ` (${+k.surchargePercent}%)` : ''}</span>` : many ? '<span class="badge">No extra fee</span>' : '';
        const mark = k.logo && /^data:image\/(png|jpeg|webp|svg\+xml|gif);/.test(k.logo) ? `<img src="${esc(k.logo)}" alt="" width="24" height="24" style="object-fit:contain">` : ICON[k.kind];
        return `<div class="opt" data-method="${esc(k.key)}" data-kind="${k.kind}" data-name="${esc(k.name)}" data-sur="${sur}" data-n="${k.instalments}">
<button type="button" class="optbtn"${many ? '' : ' tabindex="-1" style="cursor:default"'}>${many ? '<span class="radio"></span>' : ''}<span class="optmark">${mark}</span><span><b>${esc(k.name)}</b><small>${esc(k.about)}</small></span>${badge}</button>
<div class="panel">${form(k, p.amount + sur)}</div></div>`;
      })
      .join('');
    body = `<div class="who">${logo(m.logo, m.name)}<div><b>${esc(m.name)}</b><br><small>${esc(p.description || 'Payment')}</small></div></div>
<div class="sum"><div><span>Amount</span><span>${esc(money(p.amount))}</span></div><div id="s-sur-row" style="display:none"><span id="s-sur-name"></span><span id="s-sur"></span></div><div class="total"><span>Total</span><span id="s-total">${esc(money(p.amount))}</span></div></div>
${opts}<a class="cancel" href="/pay/${id}/cancel">Cancel</a>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pay</title><style>${STYLE}</style></head><body><main data-id="${esc(id)}" data-currency="${esc(p.currency)}" data-amount="${p.amount}"><small class="test">${test ? 'TEST MODE · no money moves' : ''}</small>${body}</main><script>${SCRIPT}</script></body></html>`;
}
