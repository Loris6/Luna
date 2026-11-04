// Gerät/Betriebssystem erkennen – für iOS-Footer, Android-Footer und Beschriftungen (Face ID, Fingerabdruck …).
const ua = navigator.userAgent || '';
const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1; // iPadOS meldet sich als Mac

export const platform = {
  ios: /iPhone|iPad|iPod/.test(ua) || touchMac,
  android: /Android/i.test(ua),
  mac: /Mac/.test(navigator.platform || ua) && !touchMac,
  windows: /Win/.test(navigator.platform || ua),
  standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
};
platform.os = platform.ios ? 'ios' : platform.android ? 'android' : 'desktop';

export function biometricLabel() {
  if (platform.ios) return 'Face ID / Touch ID';
  if (platform.mac) return 'Touch ID';
  if (platform.android) return 'Fingerabdruck / Gesichtserkennung';
  if (platform.windows) return 'Windows Hello';
  return 'Gerätesperre';
}

export function applyPlatformClasses() {
  const b = document.documentElement.classList;
  b.add('os-' + platform.os);
  if (platform.standalone) b.add('standalone');
}
