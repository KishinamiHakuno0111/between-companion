import {createStore,seeds} from '../core.js';
export function createTestStore() {
  const store=createStore();
  const settings=store.settings();settings.api={...settings.api,provider:"openai",baseUrl:"https://api.openai.com/v1",contextTokens:131072};store.saveSettings(settings);
  for(const seed of seeds){store.saveCharacter({...seed,playerOverride:null});store.addMessage(seed.id,'assistant',seed.greeting,{greeting:true});}
  return store;
}
