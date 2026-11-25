//left pad
function pad(num, size) {
  return ('000' + num).slice(-size);
}

//UUID generation
//https://stackoverflow.com/a/2117523/761902
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Read a cookie visible to the current page.
 * @param {string} cname The cookie name.
 * @returns {string} The cookie value, or an empty string if the cookie is missing.
 */
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

/**
 * Write a cookie with a site-wide path.
 * @param {string} cname The cookie name.
 * @param {string|number} cvalue The value to store.
 * @param {number} [exdays] The lifetime in days when setting an expiration.
 */
function setCookie(cname, cvalue, exdays) {
  var d = new Date();
  d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
  var expires = "expires=" + d.toUTCString();
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

/**
 * Probe browser storage with a write and removal.
 * @returns {boolean} Whether browser storage is writable.
 */
function isLocalStorageSupported() {
  var probeKey = 'nv';
  try {
    localStorage.setItem(probeKey, probeKey);
    localStorage.removeItem(probeKey);
    return true;
  } catch (error) {
    console.log('Browser storage is unavailable.', error.name);
    return false;
  }
}

/**
 * Encode a value as Base64 and save it in browser storage.
 * @param {string} key The storage key.
 * @param {string} value A value that the browser can Base64-encode.
 * @returns {boolean} Whether the value was encoded and saved.
 */
function saveKeyValueToLocalStorage(key, value) {
  try {
    localStorage.setItem(key, btoa(value));
    return true;
  } catch (error) {
    console.log('Unable to encode or save the value in browser storage.', error.name);
    return false;
  }
}

/**
 * Read a Base64-encoded value from browser storage.
 * @param {string} key The storage key.
 * @returns {string|boolean} The decoded value, or false if reading or decoding fails.
 */
function getKeyValueFromLocalStorage(key) {
  try {
    return atob(localStorage.getItem(key));
  } catch (error) {
    console.log('Unable to read or decode the value from browser storage.', error.name);
    return false;
  }
}

/**
 * Format the label for a message, year, or message type.
 * @param {MsgType|number} msgType The message type, or -1 to omit the type.
 * @param {number} [msgYear] The message year.
 * @param {number} [msgNumber] The message number when formatting an individual message.
 * @returns {string} The display label.
 */
function shortNameForMessage(msgType, msgYear, msgNumber) {
  var shortName = '';
  if (msgType > -1) {
    shortName += msgTypeToString(msgType) + ' ';
  }
  if (msgNumber > 0) {
    shortName += pad(msgNumber, 3) + '/';
  }
  if (msgYear > 0) {
    shortName += (msgNumber > 0 ? msgYear % 1000 : msgYear).toString();
  }
  return shortName;
}
