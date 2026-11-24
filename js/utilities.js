//left pad
function pad(num, size) {
  return ('000' + num).slice(-size);
}

/**
 * Identify the mobile platform so the app link can open the appropriate store.
 * @returns {string} The platform name android, ios, or unknown.
 * @see https://stackoverflow.com/a/21742107/761902
 */
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

/**
 * Build the message body from text nodes and clickable references.
 * @param {string} body The plain-text message body.
 * @param {string} [excludeText] An exact reference to leave as plain text.
 * @param {function} [onOpenMessage] Opens a referenced type, year, and message number in the viewer.
 * @returns {DocumentFragment} The text and reference links ready for the modal.
 */
function linkDocumentAndMessageReferences(body, excludeText, onOpenMessage) {
  var matches = [];

  function collectMatches(pattern, createLink) {
    var expression = new RegExp(pattern.source, 'g');
    var match;
    while ((match = expression.exec(body)) !== null) {
      if (match[0] !== excludeText) {
        matches.push({ match: match, createLink: createLink });
      }
    }
  }

  function createDocumentSearchLink(match) {
    var link = document.createElement('a');
    var query = match[0] + ' site:gov OR site:mil OR site:us OR site:ansonliu.com OR navadmin-viewer.github.io';
    link.href = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    return link;
  }

  function createMessageLoadLink(match) {
    var msgType = stringToMsgType(match[1]);
    var msgYear = 2000 + parseInt(match[3], 10);
    var msgNumber = parseInt(match[2], 10);
    var link = document.createElement('a');
    link.href = Navadmin.navigation.shareLink(msgType, msgYear, msgNumber, false);
    link.addEventListener('click', function(event) {
      if (!onOpenMessage || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0)
        return;

      event.preventDefault();
      onOpenMessage(msgType, msgYear, msgNumber);
    });
    return link;
  }

  collectMatches(reDocument, createDocumentSearchLink);
  collectMatches(reMessage, createMessageLoadLink);
  matches.sort(function(a, b) {
    return a.match.index - b.match.index;
  });

  var fragment = document.createDocumentFragment();
  var offset = 0;
  for (var i = 0; i < matches.length; i++) {
    var item = matches[i];
    var match = item.match;
    if (match.index < offset)
      continue;

    if (match.index > offset) {
      fragment.appendChild(document.createTextNode(body.slice(offset, match.index)));
    }
    var link = item.createLink(match);
    link.appendChild(document.createTextNode(match[0]));
    fragment.appendChild(link);
    offset = match.index + match[0].length;
  }
  fragment.appendChild(document.createTextNode(body.slice(offset)));
  return fragment;
}
