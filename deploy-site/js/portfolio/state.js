// Single source of truth for the portfolio being built.
// Both the wizard and chat journeys mutate this same object.

const STORAGE_KEY = 'portfolio-ai.draft.v1';

const DEFAULT_STATE = {
  identity: {
    firstName: '', lastName: '', headline: '', location: '', email: '',
    avatar: '',
    social: { linkedin: '', github: '', twitter: '', website: '' }
  },
  about: { tagline: '', bio: '' },
  experience: [],
  projects: [],
  skills: { groups: [] },
  education: [],
  contact: { ctaText: 'Get in touch', formEnabled: false },
  theme: { templateId: 'minimal', accent: '#c4a96b', fontPair: 'serif-modern', mode: 'light' }
};

function uid(prefix){ return prefix + '-' + Math.random().toString(36).slice(2, 9); }

function deepClone(v){ return JSON.parse(JSON.stringify(v)); }

function deepMerge(target, patch){
  if (Array.isArray(patch)) return patch.slice();
  if (patch && typeof patch === 'object'){
    const out = (target && typeof target === 'object' && !Array.isArray(target)) ? { ...target } : {};
    for (const k of Object.keys(patch)){
      out[k] = deepMerge(out[k], patch[k]);
    }
    return out;
  }
  return patch;
}

function load(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepClone(DEFAULT_STATE);
    return deepMerge(deepClone(DEFAULT_STATE), JSON.parse(raw));
  } catch { return deepClone(DEFAULT_STATE); }
}

function save(s){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

const PortfolioState = (() => {
  let state = load();
  const listeners = new Set();

  function get(){ return state; }

  function set(patch){
    state = deepMerge(state, patch);
    save(state);
    listeners.forEach(fn => { try { fn(state); } catch(e){ console.error(e); } });
  }

  function replace(next){
    state = deepMerge(deepClone(DEFAULT_STATE), next || {});
    save(state);
    listeners.forEach(fn => { try { fn(state); } catch(e){ console.error(e); } });
  }

  function subscribe(fn){
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function reset(){
    state = deepClone(DEFAULT_STATE);
    save(state);
    listeners.forEach(fn => { try { fn(state); } catch(e){ console.error(e); } });
  }

  // List helpers (immutable array updates that pass through set())
  function listAdd(path, item){
    const list = pathGet(state, path) || [];
    set(patchFromPath(path, [...list, item]));
  }
  function listUpdate(path, index, patch){
    const list = pathGet(state, path) || [];
    const next = list.map((it, i) => i === index ? deepMerge(it, patch) : it);
    set(patchFromPath(path, next));
  }
  function listRemove(path, index){
    const list = pathGet(state, path) || [];
    const next = list.filter((_, i) => i !== index);
    set(patchFromPath(path, next));
  }

  return { get, set, replace, subscribe, reset, listAdd, listUpdate, listRemove, uid };
})();

function pathGet(obj, path){
  return path.split('.').reduce((o, k) => o == null ? o : o[k], obj);
}
function patchFromPath(path, value){
  const keys = path.split('.');
  const out = {};
  let cursor = out;
  for (let i = 0; i < keys.length - 1; i++){
    cursor[keys[i]] = {};
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
  return out;
}

// Convenience constructors for list items.
const PortfolioFactory = {
  experience: () => ({ id: PortfolioState.uid('exp'), role: '', company: '', dates: '', highlights: [] }),
  project: () => ({ id: PortfolioState.uid('proj'), title: '', summary: '', role: '', links: { live: '', repo: '' }, image: '', tech: [] }),
  education: () => ({ id: PortfolioState.uid('edu'), school: '', degree: '', dates: '', gpa: '' }),
  skillGroup: () => ({ id: PortfolioState.uid('sg'), name: '', items: [] })
};

window.PortfolioState = PortfolioState;
window.PortfolioFactory = PortfolioFactory;
