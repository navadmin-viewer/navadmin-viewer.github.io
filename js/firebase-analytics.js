(function() {
  if (window.location.protocol !== 'https:' && window.location.protocol !== 'http:') return;

  var navadmin = window.Navadmin || (window.Navadmin = {});
  var firebaseConfig = {
    apiKey: "AIzaSyBV-G539Qxzz-KtCjT4Bx6v7avTJECrCN8",
    authDomain: "navadmin-ios.firebaseapp.com",
    databaseURL: "https://navadmin-ios.firebaseio.com",
    projectId: "navadmin-ios",
    storageBucket: "navadmin-ios.appspot.com",
    messagingSenderId: "404757436431",
    appId: "1:404757436431:web:f3c40684e54f796de66b7a",
    measurementId: "G-EDWQZT9FX9"
  };
  var firebaseAnalyticsStarted = false;

  function loadFirebaseSdk(url, onLoad) {
    var firebaseSdkScript = document.createElement('script');
    firebaseSdkScript.async = true;
    firebaseSdkScript.onload = onLoad;
    firebaseSdkScript.onerror = function() {
      console.warn('Could not load a Firebase Analytics SDK.', url);
    };
    firebaseSdkScript.src = url;
    document.head.appendChild(firebaseSdkScript);
  }

  function initializeFirebaseAnalytics() {
    var firebase = window.firebase;
    if (!firebase || typeof firebase.analytics !== 'function') return;

    try {
      firebase.initializeApp(firebaseConfig);
      firebase.analytics();
    } catch (error) {
      console.warn('Could not initialize Firebase Analytics.', error);
    }
  }

  navadmin.startFirebaseAnalytics = function() {
    if (firebaseAnalyticsStarted) return;
    firebaseAnalyticsStarted = true;

    loadFirebaseSdk('https://www.gstatic.com/firebasejs/9.8.0/firebase-app-compat.js', function() {
      if (window.firebase && typeof window.firebase.initializeApp === 'function') {
        loadFirebaseSdk('https://www.gstatic.com/firebasejs/9.8.0/firebase-analytics-compat.js', initializeFirebaseAnalytics);
      }
    });
  };

  var bootstrap = document.getElementById('firebase-analytics-bootstrap');
  if (bootstrap && bootstrap.hasAttribute('data-autostart')) navadmin.startFirebaseAnalytics();
})();
