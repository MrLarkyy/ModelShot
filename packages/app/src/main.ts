import '@modelshot/brand/tokens.css';
import '@modelshot/brand/fonts.css';
import './app.css';
import { appTitle } from './appTitle';
import { showHandoff } from './showHandoff';

const heading = document.getElementById('title');
if (heading) heading.textContent = appTitle();

const status = document.getElementById('handoff');
if (status && new URLSearchParams(location.search).get('open') === 'handoff') void showHandoff(status);
