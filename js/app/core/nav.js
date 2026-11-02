/* Navigation state — what every view needs to cooperate with the router. */

/* ES modules cannot reassign each other's bindings, so the values that several views write live here as
   properties of one exported object.
     navToken    — bumped on every navigation. Async renderers capture it at entry and bail (via gone()) after each
                   await once it has moved on — otherwise a slow fetch from the previous view overwrites the current
                   one, re-binds its listeners (double-toggling filters into no-ops) or registers its poll timers
                   into the new view's list.
     liveTimers  — every polling surface registers here (addLiveTimer); all are cleared on navigation.
     pendingMapQ — query parsed from #/map?routes=…&ids=…&title=…&embed=1, consumed by the network map.
     map         — the current view's Leaflet instance, removed on navigation. */
export const state = { navToken: 0, liveTimers: [], pendingMapQ: null, map: null };

export const routesViewState = { q:'', type:null, op:null, prop:null, deck:null, freq:null };  // survives back-nav
export const addLiveTimer = t => { state.liveTimers.push(t); return t; };
export const gone = tok => tok !== state.navToken;
