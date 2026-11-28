// Firebase web config for project kedo-f2b75. These values are public by design;
// access is enforced by Firebase Auth + the Firestore/Storage security rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyBIMRdQeVBVsi2OqIOjyrID1Sjba4YBBlk',
  authDomain: 'kedo-f2b75.firebaseapp.com',
  projectId: 'kedo-f2b75',
  storageBucket: 'kedo-f2b75.firebasestorage.app',
  messagingSenderId: '779778408740',
  appId: '1:779778408740:web:b3e41cc51659d3c646b3b1',
};
export const FUNCTIONS_REGION = 'us-central1';

// Projects Kedo runs. Created in Firestore on first sign-in if missing.
export const SEED_PROJECTS = [
  { id: 'alke-network', name: 'Alke Network', url: 'https://alke.network', color: '#C46A3B', order: 1 },
  { id: 'alkebuleum', name: 'Alkebuleum', url: '', color: '#2FB8A6', order: 2 },
];

// Visual post studios (full design tools) per project. Each one runs in an iframe with
// studio/kedo-bridge.js, which sends finished posts to the scheduler.
export const STUDIOS = {
  'alke-network': {
    name: 'ALKÉ Network Post Studio',
    src: 'studio/alke-network.html',
    description: 'The campaign week, weekly anchors, flex posts and profile art, with captions for X, Instagram and LinkedIn, the hashtag, the first reply and the hard-lines check.',
  },
};

// Optional simple text templates to seed per project (also editable in the admin).
export const SEED_TEMPLATES = {};
