import { appTitle } from './appTitle';

const heading = document.getElementById('title');
if (heading) heading.textContent = appTitle();
