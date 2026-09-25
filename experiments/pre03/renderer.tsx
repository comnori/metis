import React, {useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history, undo, redo} from '@codemirror/commands';
import {autocompletion} from '@codemirror/autocomplete';
import DOMPurify from 'dompurify';
type Bridge={readDocument:(path:unknown)=>Promise<unknown>; analyze:()=>Promise<{html:string;sqlite:string;node:string}>};
declare global {interface Window {probe:Bridge; editor:EditorView; undoProbe:()=>boolean; redoProbe:()=>boolean; purifyProbe:(input:string)=>string;}}
function App(){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const view=new EditorView({parent:host.current!,state:EditorState.create({doc:'= PRE-03\n\n한글 source  \n',extensions:[history(),autocompletion({override:[()=>({from:0,options:[{label:'xref:domain/aggregate.adoc#aggregate[Aggregate]'}]})]})]})});
  window.editor=view;window.undoProbe=()=>undo(view);window.redoProbe=()=>redo(view);
  window.purifyProbe=input=>DOMPurify.sanitize(input,{USE_PROFILES:{html:true}});
  window.probe.analyze().then(result=>{document.querySelector('#worker')!.textContent=JSON.stringify(result);});
  return()=>view.destroy();
 },[]);
 return <main><h1>PRE-03 compatibility probe</h1><div ref={host}/><pre id="worker"/><iframe title="preview" sandbox="" srcDoc={'<script>parent.__escaped=1</script><svg onload="parent.__escaped=2"></svg><p>Sandbox probe</p>'}/></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
