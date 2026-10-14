/**
 * @format
 */
// Must be first: provides crypto.getRandomValues backed by java.security.SecureRandom.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './src/app/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
