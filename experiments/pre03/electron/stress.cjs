process.parentPort.on('message',()=>{
 process.parentPort.postMessage('started');
 // Deliberate CPU-bound test job; the parent owns cancellation and a watchdog.
 while(true){Math.sqrt(1234567);}
});
