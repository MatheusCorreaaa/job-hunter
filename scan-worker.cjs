'use strict';

const {scan,publicFetch}=require('./jobs.cjs');
const {parentPort}=process;

parentPort.once('message',({data})=>{
  scan({
    ...data,
    fetcher:publicFetch,
    onProgress:(progress)=>parentPort.postMessage({progress})
  }).then(
    (result)=>parentPort.postMessage({result}),
    ()=>parentPort.postMessage({error:true})
  );
});
