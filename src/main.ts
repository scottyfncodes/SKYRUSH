import './styles/main.css';
import { App } from './app/App';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');

const params = new URLSearchParams(window.location.search);
const app = new App(root, { enableTestHarness: params.get('e2e') === '1' });
app.start();
