/*
 * https://www.tinabellvance.com/posts/getting-url-parameters-in-ie11-using-jquery-vanilla-javascript-and-es6/
 */
function getUrlParameter(location, name) {
  name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
  var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
  var results = regex.exec(location);
  return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
};

//left pad
function pad(num, size) {
  return ('000' + num).slice(-size);
}

//https://stackoverflow.com/a/21742107/761902
function getMobileOperatingSystem() {
  var userAgent = navigator.userAgent || navigator.vendor || window.opera;
  if (/android/i.test(userAgent))
    return "android";
  if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream)
    return "ios";
  return "unknown";
}

//UUID generation
//https://stackoverflow.com/a/2117523/761902
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getCookie(cname) {
  var name = cname + "=";
  var decodedCookie = decodeURIComponent(document.cookie);
  var ca = decodedCookie.split(';');
  for (var i = 0; i < ca.length; i++) {
    var c = ca[i];
    while (c.charAt(0) == ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return c.substring(name.length, c.length);
    }
  }
  return "";
}

function setCookie(cname, cvalue, exdays) {
  var d = new Date();
  d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
  var expires = "expires=" + d.toUTCString();
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function isLocalStorageSupported() {
  var mod = 'nv'
  try {
    localStorage.setItem(mod, mod);
    localStorage.removeItem(mod);
    return true;
  } catch(e) {
      return false;
  }
}

function saveKeyValueToLocalStorage(k, v) {
  try {
    localStorage.setItem(k, atob(v));
    return true;
  } catch (e) {
    console.log('Unable to store data:', e);
    return false;
  }
}

function getKeyValueFromLocalStorage(k) {
  try {
    return btoa(localStorage.getItem(k));
  } catch (e) {
    console.log('Unable to get data:', e);
    return false;
  }
}

function saveCachedMessagesToLocalStorage() {
  if (cachedMessages) {
    try {
      localStorage.setItem(cachedMessagesLocalStorageKey, serializeMap(cachedMessages))
      return true;
    } catch (e) {
      console.log('Unable to store messages:', e);
      return false;
    }
  }
  return false;
}

function latestYearForMsgType(msgType) {
  if (!cachedMessages || !cachedMessages.get(msgType)) {
    return -1;
  }

  var ly = -1;
  cachedMessages.get(msgType).forEach(function(v, k) {
    if (ly == -1)
      ly = k;
  });
  return ly;
}

function shortNameForMessage(msgType, msgYear, msgNumber) {
  var shortName = msgTypeToString(msgType) + ' ';
  if (msgNumber > 0) {
    shortName += pad(msgNumber, 3) + '/';
  }
  if (msgYear > 0) {
    if (msgNumber > 0) {
      shortName += (msgYear % 1000).toString();
    } else {
      shortName += msgYear.toString();
    }
    
  }
  return shortName
}