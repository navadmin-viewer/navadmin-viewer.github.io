(function(window) {
  var Navadmin = window.Navadmin || (window.Navadmin = {});
  var shareServer = 'https://navadmin-viewer.github.io';

  function getUrlParameter(url, name) {
    var parameter = new RegExp('[\\?&]' + name + '=([^&#]*)').exec(url);
    if (!parameter) {
      return '';
    }

    try {
      return decodeURIComponent(parameter[1].replace(/\+/g, ' '));
    } catch (error) {
      console.log('Ignoring a malformed URL parameter.', name);
      return '';
    }
  }

  /**
   * Read the message type, year, and number from a viewer URL.
   * @param {string} url The URL to read.
   * @returns {Object} The type, year, and number. A value of -1 marks an unselected year or message.
   */
  function readRoute(url) {
    var type = stringToMsgType(getUrlParameter(url, 'type'));
    var year = Number(getUrlParameter(url, 'year'));
    var number = Number(getUrlParameter(url, 'number'));

    if (type == MsgType.UNKNOWN) {
      return { type: MsgType.NAVADMIN, year: -1, number: -1 };
    }
    if (year <= 0 || year % 1 !== 0) {
      year = -1;
    }
    if (year == -1 || number <= 0 || number % 1 !== 0) {
      number = -1;
    }
    return { type: type, year: year, number: number };
  }

  function createURLParameters(type, year, number) {
    var query = '?type=' + msgTypeToString(type);
    if (year >= 0) {
      query += '&year=' + year;
    }
    if (number >= 0) {
      query += '&number=' + number;
    }
    return query;
  }

  /**
   * Build the absolute browser or native-app share link for a viewer selection.
   * @param {MsgType} type The message type.
   * @param {number} year The year, or -1 for a type-only link.
   * @param {number} number The message number, or -1 for a list link.
   * @param {boolean} [redirect] Whether to use the native-app redirect page.
   * @returns {string} The share URL.
   */
  function shareLink(type, year, number, redirect) {
    var path = redirect ? '/view-message/' : '/';
    return shareServer + path + createURLParameters(type, year, number);
  }

  /**
   * Forward the shared-link parameters to the web viewer with URL encoding.
   * @param {string} search The redirect page's query string.
   * @returns {string} The relative URL to open in the web viewer.
   */
  function redirectURL(search) {
    return '../?type=' + encodeURIComponent(getUrlParameter(search, 'type')) +
      '&year=' + encodeURIComponent(getUrlParameter(search, 'year')) +
      '&number=' + encodeURIComponent(getUrlParameter(search, 'number'));
  }

  function messageHistoryState() {
    var state = window.history.state;
    return state && state.messageDepth > 0 ? state : null;
  }

  /**
   * Read the active route and the list it came from.
   * @returns {Object} The route, originating list, message depth, and optional opener.
   */
  function readHistory() {
    var route = readRoute(window.location.href);
    var state = route.number > 0 ? messageHistoryState() : null;
    return {
      route: route,
      list: state ? { type: state.listType, year: state.listYear } : route,
      depth: state ? state.messageDepth : 0,
      opener: state && state.opener || null
    };
  }

  function pushMessageEntry(type, year, number, list, depth, opener) {
    window.history.pushState({
      messageDepth: depth,
      listType: list.type,
      listYear: list.year,
      opener: opener || null
    }, '', createURLParameters(type, year, number));
  }

  function replaceWithList(list) {
    window.history.replaceState(null, '', createURLParameters(list.type, list.year));
  }

  /**
   * Give a direct message visit a list entry for Back and Close.
   * @param {Object} route The initial viewer route.
   */
  function seedMessageHistory(route) {
    if (route.number > 0 && !messageHistoryState()) {
      replaceWithList(route);
      pushMessageEntry(route.type, route.year, route.number, route, 1);
    }
  }

  /**
   * Add a newly selected list to browser history.
   * @param {MsgType} type The message type.
   * @param {number} year The selected year, or -1 for the latest available year.
   */
  function pushList(type, year) {
    window.history.pushState(null, '', createURLParameters(type, year));
  }

  /**
   * Add a message entry and preserve the list beneath the open messages.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {number} number The message number.
   * @param {Object} list The originating list selection.
   * @param {Object|null} previousMessage The message already open, if any.
   * @param {Object|null} [opener] The original subject link’s type, year, and number.
   * @returns {number} The number of entries back to the originating list.
   */
  function pushMessage(type, year, number, list, previousMessage, opener) {
    var depth = previousMessage ? previousMessage.depth + 1 : 1;
    if (previousMessage && !previousMessage.depth) {
      console.log('Adding the originating list before opening a message reference.');
      replaceWithList(list);
      pushMessageEntry(previousMessage.type, previousMessage.year, previousMessage.number, list, 1, opener);
      depth = 2;
    }
    pushMessageEntry(type, year, number, list, depth, opener);
    return depth;
  }

  /**
   * Return to the originating list after Close.
   * @param {Object} list The list selection.
   * @param {number} depth The number of entries back to the list.
   */
  function closeMessage(list, depth) {
    if (depth > 0) {
      console.log('Closing the message and returning to the originating list ' + depth + ' history step(s) back.');
      window.history.go(-depth);
    } else {
      console.log('No originating list is in history. Replacing the message URL with the list URL.');
      replaceWithList(list);
    }
  }

  /**
   * Notify the viewer when the browser selects an existing history entry.
   * @param {function} handler The callback that restores the list and message.
   */
  function onPopState(handler) {
    window.addEventListener('popstate', function() {
      console.log('Back or Forward selected an existing history entry.');
      handler();
    });
  }

  Navadmin.navigation = {
    readRoute: readRoute,
    readHistory: readHistory,
    seedMessageHistory: seedMessageHistory,
    pushList: pushList,
    pushMessage: pushMessage,
    closeMessage: closeMessage,
    onPopState: onPopState,
    shareLink: shareLink,
    redirectURL: redirectURL
  };
})(window);
