// First, before the app: Android can restart the shift's location job right after the app was
// killed, and the job must find its task already defined (Tester R2-3: a crash on relaunch).
import './src/lib/shiftService';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
