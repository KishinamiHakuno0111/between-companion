import {createStore,seeds} from '../core.js';
export function createTestStore() {
  const store=createStore();
  for(const seed of seeds){store.saveCharacter({...seed,playerOverride:null});store.addMessage(seed.id,'assistant',seed.greeting,{greeting:true});}
  return store;
}
