import '@modelshot/brand/tokens.css';
import '@modelshot/brand/fonts.css';
import './app.css';
import { App } from './App';
import { appTitle } from './appTitle';
import { registerServiceWorker } from './offline/registerServiceWorker';
import { createAppStateStore } from './state/appStateDb';

const heading = document.getElementById('title');
if (heading) heading.textContent = appTitle();

const app = new App(createAppStateStore());
registerServiceWorker();
if (import.meta.env.MODE === 'e2e') {
  void import('./e2eHook').then((hook) => hook.installE2eHook(app));
}
void app.start();
