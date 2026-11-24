var availableMsgTypes = [
  MsgType.NAVADMIN,
  MsgType.ALNAV,
  MsgType.MARADMIN,
  MsgType.ALMAR
];

// Callbacks compare their selection object with the current one before changing the UI.
var listSelection;
// Keep the values actually rendered alongside each row. Null represents an unavailable list.
// Leave this undefined until the first render so the HTML placeholder gets cleared.
var displayedRows;
var selectedMessage;

var loadingProgress;
var msgModal;
var msgModalTitle;
var msgModalBody;
var pageDescription;
var listDescription;

$(document).ready(function() {
  $(document).ajaxStart(function() { $('html').addClass('wait'); });
  $(document).ajaxStop(function() { $('html').removeClass('wait'); });

  loadingProgress = $('#loading-progress');
  msgModal = $('#msg-body-modal');
  msgModalTitle = msgModal.find('.modal-title');
  msgModalBody = msgModal.find('.modal-body');
  pageDescription = document.querySelector('meta[name="description"]');
  listDescription = pageDescription ? pageDescription.getAttribute('content') : '';

  Navadmin.messageStore.load();

  var visits = parseInt(getCookie(COOKIE_VISITS), 10) || 0;
  setCookie(COOKIE_VISITS, visits + 1);

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      console.log('Page hidden. Saving the message cache.');
      Navadmin.messageStore.save();
    }
  });

  setFilterMsgTypeDropdown();
  $('#msg-search-input').on('input keyup change', msgFilterSearchInputChanged);
  $('#msg-search-input').on('paste cut', function() {
    window.setTimeout(msgFilterSearchInputChanged, 0);
  });
  $('#nav-app-link').click(navigateToAppStore);
  msgModal.find('.modal-share-link').click(shareUserSelectedMessageLink);
  msgModal.on('hide.bs.modal', closeMessage);
  // Bootstrap ignores show/hide requests while a modal is transitioning.
  msgModal.on('shown.bs.modal', function() {
    if (!selectedMessage) {
      msgModal.modal('hide');
    }
  });
  msgModal.on('hidden.bs.modal', function() {
    if (selectedMessage) {
      msgModal.modal('show');
    }
  });

  var route = Navadmin.navigation.readRoute(window.location.href);
  if (route.number > 0) {
    Navadmin.navigation.seedMessageHistory(route);
    if (typeof analytics !== 'undefined') {
      analytics.logEvent('LaunchParameter', {
        messageNumber: shortNameForMessage(route.type, route.year, route.number)
      });
    }
  }

  restoreHistoryRoute();
  Navadmin.navigation.onPopState(restoreHistoryRoute);
  getBroadcast(null);
});

/**
 * Set the loading indicator to a loading, error, or hidden state.
 * @param {boolean} loading Whether the list is loading.
 * @param {string|null} [statusText] Text to display. When loading is false,
 *   a message is shown as an error and an empty value hides the indicator.
 */
function setUIInLoadingStatus(loading, statusText) {
  var bar = loadingProgress.find('.progress-bar');
  bar.toggleClass('bg-danger', !loading && !!statusText);
  bar.text(statusText || '');
  loadingProgress.toggle(loading || !!statusText);
}

/**
 * Add a filter link that opens the chosen list in the viewer.
 * @param {jQuery} menu The dropdown menu to append to.
 * @param {string|number} label The displayed menu item text.
 * @param {string} link The URL used for regular browser link actions.
 * @param {MsgType} type The message type to select.
 * @param {number} year The message year, or -1 for the latest available year.
 */
function addListFilterItem(menu, label, link, type, year) {
  var item = $('<a>', { 'class': 'dropdown-item', 'href': link }).text(label);
  item.click(function(e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    if (listSelection.type == type && listSelection.year == year) {
      console.log('The selected filter is already active. Refreshing the list.');
      loadMessageList(type, year);
      return;
    }
    Navadmin.navigation.pushList(type, year);
    restoreHistoryRoute();
  });
  menu.append(item);
}

/**
 * Populate the message type filter dropdown with the available message types.
 */
function setFilterMsgTypeDropdown() {
  var menu = $('#msg-type-dropdown-menu').empty();
  availableMsgTypes.forEach(function(type) {
    addListFilterItem(menu, msgTypeToString(type), Navadmin.navigation.shareLink(type, -1, -1, false), type, -1);
  });
}

/**
 * Populate the year filter from the cache and set its button label.
 * @param {MsgType} type The message type whose cached years to list.
 * @param {number} year The year to display. Pass -1 to use the latest cached year.
 * @returns {number} The selected year, or -1 if no year is available.
 */
function setFilterMsgYearDropdown(type, year) {
  var menu = $('#msg-year-dropdown-menu').empty();
  Navadmin.messageStore.years(type).forEach(function(availableYear) {
    addListFilterItem(menu, availableYear, Navadmin.navigation.shareLink(type, availableYear, -1, false), type, availableYear);
  });

  var displayedYear = year > 0 ? year : Navadmin.messageStore.latestYear(type);
  $('#msg-year-dropdown').text(displayedYear > 0 ? displayedYear : 'N/A');
  return displayedYear;
}

/**
 * Display cached rows for the selection and refresh its years and messages.
 * @param {MsgType} type The message type to display.
 * @param {number} year The year to display, or -1 for the latest available year.
 */
function loadMessageList(type, year) {
  var selection = { type: type, year: year, displayedYear: -1 };
  listSelection = selection;
  var listName = shortNameForMessage(type, year).trim();
  console.log('Loading the message list for ' + listName + '.');
  $('#msg-type-dropdown').text(msgTypeToString(type));
  $('#msg-search-input').val('');
  msgFilterSearchInputChanged();

  var displayedYear = setFilterMsgYearDropdown(type, year);
  var hasMessageList = refreshMessageTable(type, displayedYear);
  setUIInLoadingStatus(!hasMessageList, hasMessageList ? null : 'Getting available messages');

  getYearsForMsgType(type, [], false, function onYearsLoaded(yearsResult) {
    if (listSelection !== selection) {
      console.log('Ignoring the year list for ' + listName + ' because the selection changed.');
      return;
    }
    var responseYear = setFilterMsgYearDropdown(type, year);
    if (responseYear != displayedYear) {
      console.log('The latest available year for ' + listName + ' changed to ' + responseYear + '.');
      displayedYear = responseYear;
      hasMessageList = refreshMessageTable(type, displayedYear);
      setUIInLoadingStatus(!hasMessageList, hasMessageList ? null : 'Getting available messages');
    }

    var yearName = shortNameForMessage(type, displayedYear).trim();
    getYearsForMsgType(type, [displayedYear], false, function onMetadataLoaded(metadataResult) {
      if (listSelection !== selection) {
        console.log('Ignoring the refreshed list for ' + yearName + ' because the selection changed.');
        return;
      }
      var requestFailed = metadataResult.requestOutcome === 'error' || yearsResult.requestOutcome === 'error';
      if (refreshMessageTable(type, displayedYear, !requestFailed)) {
        setUIInLoadingStatus(false);
      } else {
        console.log('Could not load the list for ' + yearName + ' and no cached list is available.');
        setUIInLoadingStatus(false, metadataResult.errorText || yearsResult.errorText);
      }
      if (selectedMessage) {
        setMessageTitle(selectedMessage);
      }
    });
  });
}

/**
 * Restore the selected list’s title and the default page description.
 */
function setListTitle() {
  var title = shortNameForMessage(listSelection.type, listSelection.displayedYear);
  document.title = title.trim() + ' - ' + NAVADMIN_VIEWER_TITLE;
  if (pageDescription) {
    pageDescription.setAttribute('content', listDescription);
  }
}

/**
 * Update the table when the row values differ from what it shows.
 * @param {MsgType} msgType The message type to display.
 * @param {number} msgYear The resolved year to display.
 * @param {boolean} [showEmptyIfUnavailable] Show the empty row if the completed
 *   requests succeeded without providing a message list.
 * @returns {boolean} Whether the table shows a list or an empty result.
 */
function refreshMessageTable(msgType, msgYear, showEmptyIfUnavailable) {
  listSelection.displayedYear = msgYear;
  if (!selectedMessage) {
    setListTitle();
  }

  var rows = snapshotMessageRows(msgType, msgYear);
  if (rows === null && showEmptyIfUnavailable) {
    rows = [];
  }
  var renderedRows = displayedRows;
  if (displayedRows) {
    renderedRows = displayedRows.map(function(entry) { return entry.message; });
  }

  var listName = shortNameForMessage(msgType, msgYear).trim();
  if (JSON.stringify(rows) === JSON.stringify(renderedRows)) {
    console.log('The displayed rows for ' + listName + ' already match the cache.');
    return rows !== null;
  }

  var table = $('#msg-list-table-body').empty();
  displayedRows = null;
  if (rows === null) {
    console.log('No cached message list is available for ' + listName + '.');
    return false;
  }

  if (rows.length === 0) {
    console.log('Showing the empty message list for ' + listName + '.');
    table.append('<tr><td></td><td>No messages available</td><td></td></tr>');
    displayedRows = [];
    return true;
  }

  console.log('Rendering the cached message list for ' + listName + ' because its row values changed.');
  var fragment = document.createDocumentFragment();
  displayedRows = rows.map(function(message) {
    var row = createMessageRow(message);
    fragment.appendChild(row[0]);
    return { message: message, row: row };
  });
  table.append(fragment);
  msgFilterSearchInputChanged();
  return true;
}

/**
 * Copy the fields used to render and filter the table in display order.
 * @param {MsgType} msgType The message type to display.
 * @param {number} msgYear The resolved year to display.
 * @returns {Object[]|null} The row values, or null when the list is unavailable.
 */
function snapshotMessageRows(msgType, msgYear) {
  var messages = Navadmin.messageStore.messages(msgType, msgYear);
  if (!messages) {
    return null;
  }

  var rows = [];
  for (var i = messages.length - 1; i >= 0; i--) {
    var message = messages[i];
    if (!message) {
      continue;
    }

    var row = {
      type: message.type,
      year: message.year,
      number: message.number,
      title: message.title || '',
      cancelled: !!message.cancelled,
      offline: !!message.Body,
      stars: -1,
      views: -1
    };
    (message.actSum || []).forEach(function(activity) {
      if (activity.actType == 'star') {
        row.stars = activity.actNumber;
      } else if (activity.actType == 'view') {
        row.views = activity.actNumber;
      }
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Build a clickable table row with the subject, offline indicator, and activity counts.
 * @param {Object} message The message values captured for this row.
 * @returns {jQuery} The rendered table row.
 */
function createMessageRow(message) {
  var row = $('<tr>').css('cursor', 'pointer').attr('msg-type', msgTypeToString(message.type));
  var number = $('<th>').text(shortNameForMessage(-1, message.year, message.number));
  if (message.offline) {
    number.addClass('offline-enabled');
  }

  var title = message.title || (message.cancelled ? 'N/A' : 'No subject found');
  if (message.cancelled) {
    row.addClass('table-danger');
  }
  var subjectLink = $('<a>', {
    'href': Navadmin.navigation.shareLink(message.type, message.year, message.number, false)
  }).text(title);
  var subject = $('<td>').append(subjectLink);

  var counts = $('<td>');
  if (message.stars > -1 || message.views > -1) {
    var starCount = $('<p>').text('\u2605\u00a0' + Math.max(message.stars, 0));
    var viewIcon = $('<img>', { 'src': 'assets/eye.svg', 'alt': 'views' });
    var viewCount = $('<p>').text('\u00a0' + Math.max(message.views, 0)).prepend(viewIcon);
    var stats = $('<div>', { 'class': 'stats-box' }).append(starCount, viewCount);
    counts.append(stats);
  }

  row.append(number, subject, counts);
  row.click(function(e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    prepareAndShowMessageModal(message.type, message.year, message.number, row);
  });
  return row;
}

/**
 * Filter the displayed rows by a case-insensitive literal match on the subject.
 */
function msgFilterSearchInputChanged() {
  if (!displayedRows) {
    return;
  }
  var search = $('#msg-search-input').val().toUpperCase();
  displayedRows.forEach(function(entry) {
    var title = (entry.message.title || '').toUpperCase();
    entry.row.toggle(title.indexOf(search) !== -1);
  });
}

/**
 * Restore the list and modal from the current URL and existing history state.
 */
function restoreHistoryRoute() {
  var entry = Navadmin.navigation.readHistory();
  var route = entry.route;
  var list = entry.list;
  var hasMessage = route.number > 0;
  var routeName = shortNameForMessage(route.type, route.year, route.number).trim();
  console.log('Restoring ' + routeName + ' from the current URL.');

  if (!hasMessage) {
    selectedMessage = null;
    msgModal.modal('hide');
  }
  if (!listSelection || listSelection.type != list.type || listSelection.year != list.year) {
    loadMessageList(list.type, list.year);
  }
  if (hasMessage) {
    showMessage(route.type, route.year, route.number, entry.depth);
  } else {
    setListTitle();
  }
}

/**
 * Open a message from the table or a reference and add its browser history entry.
 * @param {MsgType} type The message type to open.
 * @param {number} year The message year.
 * @param {number} number The message number.
 * @param {jQuery|null} [row] The table row whose cursor shows download progress.
 */
function prepareAndShowMessageModal(type, year, number, row) {
  if (selectedMessage && selectedMessage.type == type &&
      selectedMessage.year == year && selectedMessage.number == number) {
    console.log('The requested message is already selected.');
    return;
  }
  var depth = Navadmin.navigation.pushMessage(type, year, number, listSelection, selectedMessage);
  showMessage(type, year, number, depth, row);
}

/**
 * Show the message modal and fetch its metadata and body as needed.
 * @param {MsgType} type The message type to display.
 * @param {number} year The message year.
 * @param {number} number The message number.
 * @param {number} depth The number of browser history entries to go back when
 *   closing the modal. Use 0 when there is no originating list entry.
 * @param {jQuery|null} [row] The table row whose cursor shows download progress.
 */
function showMessage(type, year, number, depth, row) {
  var message = { type: type, year: year, number: number, depth: depth };
  selectedMessage = message;

  var messageName = setMessageTitle(message);
  var spinner = $('<span>', {
    'class': 'spinner-border spinner-border-sm mr-2',
    'aria-hidden': 'true'
  });
  msgModalBody.empty().append(spinner, document.createTextNode('Retrieving message\u2026'));
  msgModal.modal('show');
  if (row) {
    row.css('cursor', 'progress');
  }

  if (!Navadmin.messageStore.findMessage(type, year, number)) {
    console.log('No cached list entry for ' + messageName + '. Requesting its year metadata.');
    getYearsForMsgType(type, [year], false, function() {
      if (selectedMessage === message) {
        setMessageTitle(message);
      }
    });
  }

  getMsgBody(type, year, number, function(body, errorText) {
    if (row) {
      row.css('cursor', 'pointer');
    }

    if (displayedRows && body && Navadmin.messageStore.findMessage(type, year, number)) {
      displayedRows.forEach(function(entry) {
        if (entry.message.type == type && entry.message.year == year && entry.message.number == number) {
          entry.row.find('th').addClass('offline-enabled');
          entry.message.offline = true;
        }
      });
    }
    if (selectedMessage !== message) {
      console.log('Ignoring the body result for ' + messageName + ' because the modal selection changed.');
      return;
    }

    setMessageTitle(message);
    if (!body) {
      var messageError = errorText || 'Message not found.';
      console.log('Could not display ' + messageName + '. ' + messageError);
      msgModalBody.text(messageError);
      return;
    }
    msgModalBody.empty().append(linkDocumentAndMessageReferences(body, messageName, prepareAndShowMessageModal));

    if (typeof analytics !== 'undefined') {
      analytics.logEvent('ViewedMessage', { messageNumber: messageName });
    }
    sendViewActivity(type, year, number);
  });
}

/**
 * Update the modal title and page description using the cached subject.
 * @param {Object} message The current message selection.
 * @returns {string} The short message name used for reference matching.
 */
function setMessageTitle(message) {
  var name = shortNameForMessage(message.type, message.year, message.number);
  var cached = Navadmin.messageStore.findMessage(message.type, message.year, message.number);
  var subject = cached && cached.title;
  var title = name + (subject ? ' - ' + subject : '');
  msgModalTitle.text(title);
  document.title = title + ' - ' + NAVADMIN_VIEWER_TITLE;
  if (pageDescription) {
    pageDescription.setAttribute('content', subject || name);
  }
  return name;
}

/**
 * Close the selected message and restore the originating list in browser history.
 */
function closeMessage() {
  if (!selectedMessage) {
    return;
  }
  var depth = selectedMessage.depth;
  selectedMessage = null;
  setListTitle();
  Navadmin.navigation.closeMessage(listSelection, depth);
}

/**
 * Show the shareable URL for the message currently open in the modal.
 * @param {jQuery.Event} e The Share button click.
 */
function shareUserSelectedMessageLink(e) {
  e.preventDefault();
  if (selectedMessage) {
    var link = Navadmin.navigation.shareLink(selectedMessage.type, selectedMessage.year, selectedMessage.number, true);
    window.prompt('Copy the below share link to clipboard (\u229e Ctrl+C / \uf8ff \u2318+C)', link);
  }
}

/**
 * Open the store listing for the visitor’s platform.
 * @param {jQuery.Event} e The App link click.
 */
function navigateToAppStore(e) {
  e.preventDefault();
  var appLink = getMobileOperatingSystem() == 'android'
    ? 'https://play.google.com/store/apps/details?id=com.ansonliu.navadmin'
    : 'https://apps.apple.com/us/app/navadmin-viewer/id1345135985';
  window.location.assign(appLink);
}
