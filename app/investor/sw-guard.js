// Stale-cache guard: this portal shares the /app/ service worker registered by the carrier app. If an older
// worker still controls this page, ask it to update, activate the new one and reload once — otherwise a
// cache-first copy of an old app.js can leave the splash screen spinning forever.
(function(){ if(!('serviceWorker' in navigator)) return; var reloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange', function(){ if(reloaded) return; reloaded=true; location.reload(); });
  navigator.serviceWorker.getRegistration('/app/').then(function(reg){ if(!reg) return;
    function nudge(w){ if(w) w.postMessage({type:'SKIP_WAITING'}); }
    if(reg.waiting) nudge(reg.waiting);
    reg.addEventListener('updatefound', function(){ var w=reg.installing; if(!w) return; w.addEventListener('statechange', function(){ if(w.state==='installed' && navigator.serviceWorker.controller) nudge(w); }); });
    reg.update().catch(function(){});
  }).catch(function(){});
})();
