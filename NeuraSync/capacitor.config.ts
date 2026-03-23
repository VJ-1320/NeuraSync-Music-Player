import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.musicplayer.app',
  appName: 'NeuralSync Player',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
