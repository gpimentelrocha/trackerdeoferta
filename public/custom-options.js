import {OPTION_DEFINITIONS,builtinOptions} from './option-definitions.js';
const $=selector=>document.querySelector(selector);
export function initCustomOptions({api,toast}){
  let options=Object.fromEntries(Object.keys(OPTION_DEFINITIONS).map(kind=>[kind,builtinOptions(kind)]));
  let pending=null,loaded=false,creatingKind=null,target=null,version=0;
  const listeners=new Set(),form=$('#option-create-form');
  function refresh(){
    for(const [kind,id] of [['niche','niche-options'],['angle','creative-angles'],['format','creative-formats']]){
      const list=$('#'+id);list.replaceChildren(...options[kind].map(item=>new Option(item.label,item.value)));
    }
    for(const listener of listeners)listener();
  }
  async function load(){
    if(loaded)return;
    pending ||= api('/api/options').then(data=>{options=data.options;loaded=true;refresh();}).finally(()=>{pending=null;});
    await pending;
  }
  function error(error){$('#option-create-error').textContent=error.message;$('#option-create-error').hidden=false;}
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-add-option]');if(!button)return;
    const kind=button.dataset.addOption;if(!Object.hasOwn(OPTION_DEFINITIONS,kind))return;
    version++;creatingKind=kind;target=document.querySelector(button.dataset.optionTarget);
    form.reset();form.querySelector('[type=submit]').disabled=false;form.elements.label.maxLength=OPTION_DEFINITIONS[kind].max;
    $('#option-create-title').textContent='Criar '+OPTION_DEFINITIONS[kind].title;
    $('#option-create-error').hidden=true;
    $('#option-create-dialog').showModal();
    try{await load();}catch(problem){error(problem);}
  });
  for(const button of document.querySelectorAll('[data-close-option]'))button.addEventListener('click',()=>$('#option-create-dialog').close());
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('[type=submit]'),requestVersion=version,kind=creatingKind,input=form.elements.label.value,currentTarget=target;button.disabled=true;$('#option-create-error').hidden=true;
    try{
      await load();
      const saved=await api('/api/options',{method:'POST',body:JSON.stringify({kind,label:input})});
      const list=options[kind];
      if(!list.some(item=>item.value===saved.value))list.push(saved);
      refresh();
      if(requestVersion===version&&$('#option-create-dialog').open){
        if(currentTarget){currentTarget.value=saved.value;currentTarget.dispatchEvent(new Event('input',{bubbles:true}));currentTarget.dispatchEvent(new Event('change',{bubbles:true}));}
        $('#option-create-dialog').close();currentTarget?.focus();toast('Opção salva e selecionada.');
      }
    }catch(problem){if(requestVersion===version&&$('#option-create-dialog').open)error(problem);}finally{if(requestVersion===version)button.disabled=false;}
  });
  return {ready:load,list:kind=>options[kind],label:(kind,value)=>options[kind].find(item=>item.value===value)?.label||'Categoria personalizada',subscribe:listener=>listeners.add(listener)};
}
