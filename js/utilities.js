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