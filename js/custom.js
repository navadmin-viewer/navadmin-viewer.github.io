var availableMsgTypes = [
  MsgType.NAVADMIN,
  MsgType.ALNAV,
  MsgType.MARADMIN,
  MsgType.ALMAR
];

// Callbacks compare their selection object with the current one before changing the UI.
var listSelection;
var archiveSearch;
var activeSearch;
var searchInput;
var searchLoadingRow;
var displayedSearchRows;
var pendingYearStatus = new Map();
var yearStatusTimer;
var filterLayoutTimer;
// Keep the values actually rendered alongside each row. Null represents an unavailable list.
// Leave this undefined until the first render so the HTML placeholder gets cleared.
var displayedRows;
var selectedMessage;
// A closing message keeps its return target until both the dialog and route settle.
var messageToRestoreFocus;
var messageModalPhase = 'hidden';

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
  searchInput = document.getElementById('msg-search-input');
  searchLoadingRow = $('<tr>', { id: 'message-search-loading-row' }).append(
    $('<td>'),
    $('<td>').append($('<span>', { 'class': 'spinner-border spinner-border-sm', role: 'status' })
      .append($('<span>', { 'class': 'sr-only', text: 'Searching messages' }))),
    $('<td>')
  )[0];
  msgModal = $('#msg-body-modal');
  msgModalTitle = msgModal.find('.modal-title');
  msgModalBody = msgModal.find('.modal-body');
  pageDescription = document.querySelector('meta[name="description"]');
  listDescription = pageDescription ? pageDescription.getAttribute('content') : '';

  var visits = parseInt(getCookie(COOKIE_VISITS), 10) || 0;
  setCookie(COOKIE_VISITS, visits + 1);

  Navadmin.messageDownloads.init(messageDownloadChanged, messageYearEvicted, isOpenMessageYear);
  Navadmin.messageSearch.init(function() {
    queueMessageFilterLayout();
    msgFilterSearchInputChanged(true);
  });
  Navadmin.onMessageMetadataChanged = function(type) {
    if (activeSearch && activeSearch.type === type) refreshArchiveSearchSoon();
  };
  $('.message-filters').on('shown.bs.dropdown', function(event) {
    var menu = $(event.relatedTarget).next('.dropdown-menu')[0];
    if (menu && menu.id === 'msg-year-dropdown-menu' && listSelection) {
      $(menu).find('[data-message-year]').each(function() {
        updateYearDownloadStatus(listSelection.type, Number(this.getAttribute('data-message-year')));
      });
    }
    fitMessageFilterMenu(menu);
  });
  $(window).on('resize', queueMessageFilterLayout);
  queueMessageFilterLayout();
  $(searchInput).on('input keyup change', function() { msgFilterSearchInputChanged(true); });
  $(searchInput).on('paste cut', function() {
    window.setTimeout(function() { msgFilterSearchInputChanged(true); }, 0);
  });
  $('#nav-app-link').click(navigateToAppStore);
  msgModal.find('.modal-share-link').click(shareUserSelectedMessageLink);
  // Wait for Bootstrap to finish each transition before opening or closing again.
  msgModal.on('show.bs.modal', function() {
    messageModalPhase = 'showing';
  });
  msgModal.on('shown.bs.modal', function() {
    messageModalPhase = 'shown';
    if (selectedMessage) {
      focusMessageHeading();
    } else {
      msgModal.modal('hide');
    }
  });
  msgModal.on('hide.bs.modal', function() {
    messageModalPhase = 'hiding';
    closeMessage();
  });
  msgModal.on('hidden.bs.modal', function() {
    messageModalPhase = 'hidden';
    if (selectedMessage) {
      msgModal.modal('show');
    } else {
      restoreMessageFocus();
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

  Navadmin.messageStore.load(function() {
    setFilterMsgTypeDropdown();
    restoreHistoryRoute();
    Navadmin.navigation.onPopState(restoreHistoryRoute);
  });
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
 * @returns {jQuery} The added link.
 */
function addListFilterItem(menu, label, link, type, year) {
  var item = $('<a>', { 'class': 'dropdown-item', 'href': link }).text(label);
  item.click(function(e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    if (document.activeElement === this) {
      menu.prev('.dropdown-toggle')[0].focus();
    }
    if (listSelection.type == type && listSelection.year == year) {
      console.log('The selected filter is already active. Refreshing the list.');
      loadMessageList(type, year);
      return;
    }
    Navadmin.navigation.pushList(type, year);
    restoreHistoryRoute();
  });
  menu.append(item);
  return item;
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

/** Align the menu with its button and shift it only as far as the viewport requires. */
function fitMessageFilterMenu(menu) {
  if (!menu || !$(menu).hasClass('show')) {
    return;
  }
  var anchorLeft = menu.parentNode.getBoundingClientRect().left;
  var maxLeft = document.documentElement.clientWidth - menu.getBoundingClientRect().width;
  menu.style.left = (Math.max(0, Math.min(anchorLeft, maxLeft)) - anchorLeft) + 'px';
}

/** Measure the natural layout before stretching the buttons on a row of their own. */
function queueMessageFilterLayout() {
  if (filterLayoutTimer) return;
  filterLayoutTimer = window.setTimeout(function() {
    filterLayoutTimer = null;
    var filters = $(searchInput.parentNode);
    var buttons = filters.children('.message-filter-buttons')[0];
    filters.removeClass('message-filters-buttons-fill');
    if (searchInput.getBoundingClientRect().top > buttons.getBoundingClientRect().top) {
      filters.addClass('message-filters-buttons-fill');
    }
    filters.find('.dropdown-menu.show').each(function() { fitMessageFilterMenu(this); });
  }, 0);
}

function setMessageFilterLabel(button, label) {
  if (button.text() === label) return;
  button.text(label);
  queueMessageFilterLayout();
}

/**
 * Set the year button label and rebuild its menu when the available years change.
 * @param {MsgType} type The message type whose cached years to list.
 * @param {number} year The year to display. Pass -1 to use the latest cached year.
 * @returns {number} The selected year, or -1 if no year is available.
 */
function setFilterMsgYearDropdown(type, year) {
  var menu = $('#msg-year-dropdown-menu');
  var years = Navadmin.messageStore.years(type).filter(function(availableYear) { return availableYear > 0; });
  var displayedYear = year > 0 ? year : Navadmin.messageStore.latestYear(type);
  var button = $('#msg-year-dropdown');
  setMessageFilterLabel(button, displayedYear > 0 ? String(displayedYear) : 'N/A');
  var menuKey = type + '/' + years.join(',');
  if (menu.data('messageYearMenuKey') === menuKey) {
    return displayedYear;
  }

  var activeElement = document.activeElement;
  var focusedYearItem = $.contains(menu[0], activeElement) ?
    (activeElement.id || activeElement.getAttribute('href')) : null;
  menu.empty().data('messageYearMenuKey', menuKey);
  years.forEach(function(availableYear) {
    var item = addListFilterItem(menu, availableYear,
      Navadmin.navigation.shareLink(type, availableYear, -1, false), type, availableYear);
    item.attr('data-message-year', availableYear).empty().append(
      $('<span>', { 'class': 'message-year-label' }).text(availableYear),
      $('<span>', { 'class': 'message-year-status' }).hide()
    );
    updateYearDownloadStatus(type, availableYear);
  });
  menu.append($('<div>', { 'class': 'dropdown-divider' }), $('<button>', {
    'class': 'dropdown-item', id: 'msg-download-all-years', type: 'button'
  }).text('Download all years').prop('disabled', !years.length).on('click', function() {
    Navadmin.messageDownloads.queueAll(type);
    $('#msg-year-dropdown').focus();
  }));
  fitMessageFilterMenu(menu[0]);
  if (focusedYearItem) {
    var replacement = menu.find('.dropdown-item:visible').filter(function() {
      return (this.id || this.getAttribute('href')) === focusedYearItem;
    })[0];
    (replacement || button[0]).focus();
  }
  return displayedYear;
}

/** Update a year's download indicator without replacing its link. */
function updateYearDownloadStatus(type, year) {
  var indicator = $('#msg-year-dropdown-menu [data-message-year="' + year + '"] .message-year-status');
  if (!indicator.length) {
    return;
  }
  var status = Navadmin.messageDownloads.progress(type, year);
  var previous = indicator.data('downloadStatus');
  if (!status) {
    if (previous) indicator.removeData('downloadStatus').empty().hide();
    return;
  }
  if (previous && previous.total === status.total && previous.completed === status.completed &&
      previous.requested === status.requested && previous.active === status.active &&
      previous.temporary === status.temporary && previous.reason === status.reason) {
    return;
  }
  indicator.data('downloadStatus', status);
  var progress = indicator.children('.message-year-progress');
  indicator.children().not(progress).remove();
  if (status.completed === status.total && !status.temporary) {
    progress.remove();
    indicator.append($('<span>', {
      'class': 'message-year-complete', title: 'Download complete', role: 'img', 'aria-label': 'Download complete'
    }).text('\u2713'));
  } else if (status.total > 0 && (status.requested || status.completed)) {
    if (!progress.length) {
      progress = $('<span>', {
        'class': 'message-year-progress', role: 'progressbar',
        'aria-label': year + ' message download', 'aria-valuemin': 0
      }).append(
        $('<span>', { 'class': 'message-year-progress-fill' }),
        $('<span>', { 'class': 'message-year-progress-count' })
      ).appendTo(indicator);
    }
    var count = status.completed + '/' + status.total;
    var cacheNote = 'Cached in this tab until reload';
    progress.toggleClass('message-year-progress-active', status.active)
      .toggleClass('message-year-progress-temporary', status.temporary).attr({
        'aria-valuenow': status.completed, 'aria-valuemax': status.total,
        'aria-valuetext': count + ' downloaded' + (status.temporary ? '. ' + cacheNote : ''),
        title: status.temporary ? cacheNote : null
      });
    progress.children('.message-year-progress-fill').toggleClass('bg-warning', status.temporary)
      .css('width', (100 * status.completed / status.total) + '%');
    progress.children('.message-year-progress-count').text(count);
  } else {
    progress.remove();
  }
  if (status.reason || (status.requested && status.total === null)) {
    indicator.append($('<span>', { 'class': 'message-year-download-note' })
      .text(status.reason || 'Getting list'));
  }
  indicator.toggle(indicator.children().length > 0);
}

function queueYearDownloadStatus(type, year) {
  pendingYearStatus.set(year, type);
  if (!yearStatusTimer) {
    yearStatusTimer = window.setTimeout(function() {
      yearStatusTimer = null;
      pendingYearStatus.forEach(function(messageType, messageYear) {
        if (listSelection.type === messageType) {
          updateYearDownloadStatus(messageType, messageYear);
        }
      });
      pendingYearStatus.clear();
      fitMessageFilterMenu(document.getElementById('msg-year-dropdown-menu'));
    }, 80);
  }
}

function searchRowKey(year, number) {
  return year + '/' + number;
}

function markRowOffline(entry) {
  entry.row[0].cells[0].classList.add('offline-enabled');
  entry.message.offline = true;
}

function isOpenMessageYear(type, year) {
  return !!selectedMessage && selectedMessage.type === type && selectedMessage.year === year;
}

function hasSessionBody(type, year, number) {
  var status = Navadmin.messageStore.getBodyStatus(type, year, number);
  return status && status.status === 200 && !status.persistent;
}

/**
 * Refresh the affected year's storage indicators and searchable bodies after eviction.
 * @param {MsgType} type The message type.
 * @param {number} year The evicted year.
 * @param {Object[]} movedRecords The bodies and download outcomes moved to memory.
 */
function messageYearEvicted(type, year, movedRecords) {
  if (!listSelection || listSelection.type !== type) return;
  queueYearDownloadStatus(type, year);

  if (archiveSearch && archiveSearch.type === type) {
    var read = archiveSearch.readingBodies;
    if (read && read.year === year) read.evicted = true;
    var yearBodies = archiveSearch.bodies.get(year);
    if (yearBodies) {
      yearBodies.forEach(function(body, number) {
        if (!hasSessionBody(type, year, number)) yearBodies.delete(number);
      });
    }
    movedRecords.forEach(function(record) {
      if (record.status === 200) cacheSearchBody(archiveSearch, record, true);
    });
  }

  if (displayedRows) {
    displayedRows.forEach(function(entry) {
      var message = entry.message;
      if (message.type === type && message.year === year && message.offline) {
        entry.row[0].cells[0].classList.remove('offline-enabled');
        message.offline = false;
      }
    });
  }

  // An in-progress scan may still hold a snapshot of the evicted text or indicators.
  if (activeSearch) {
    var search = activeSearch;
    window.clearTimeout(search.timer);
    activeSearch = { type: search.type, query: search.query, fullMessage: search.fullMessage, matcher: search.matcher };
    scheduleArchiveSearch(activeSearch, 0);
  }
}

function messageDownloadChanged(type, year, record, metadataReady) {
  if (!listSelection || listSelection.type !== type) {
    return;
  }
  queueYearDownloadStatus(type, year);
  if (metadataReady && listSelection.displayedYear === year) {
    refreshMessageTable(type, year, listSelection.showEmptyIfUnavailable);
  }
  if (record && record.status === 200) {
    var saved = Navadmin.messageStore.getBodyStatus(type, year, record.number);
    if (saved && saved.status === 200 && saved.persistent) {
      if (displayedSearchRows) {
        var result = displayedSearchRows.get(searchRowKey(year, record.number));
        if (result) markRowOffline(result);
      } else if (listSelection.displayedYear === year && displayedRows) {
        for (var i = 0; i < displayedRows.length; i++) {
          var message = displayedRows[i].message;
          if (message.type === type && message.year === year && message.number === record.number) {
            markRowOffline(displayedRows[i]);
            break;
          }
        }
      }
    }
    if (archiveSearch && archiveSearch.type === type &&
        (Navadmin.messageSearch.isFullMessage() || archiveSearch.readBodyYears.has(year))) {
      cacheSearchBody(archiveSearch, record);
    }
  }
  if (record && record.status === 200 && Navadmin.messageSearch.isFullMessage()) {
    refreshArchiveSearchSoon();
  }
}

/**
 * Display cached rows for the selection, refresh its metadata, and queue the year's bodies.
 * @param {MsgType} type The message type to display.
 * @param {number} year The year to display, or -1 for the latest available year.
 */
function loadMessageList(type, year) {
  var selection = { type: type, year: year, displayedYear: -1 };
  listSelection = selection;
  if (archiveSearch && archiveSearch.type !== type) {
    archiveSearch = null;
  }
  var listName = shortNameForMessage(type, year).trim();
  console.log('Loading the message list for ' + listName + '.');
  setMessageFilterLabel($('#msg-type-dropdown'), msgTypeToString(type));
  var displayedYear = setFilterMsgYearDropdown(type, year);
  var hasMessageList = refreshMessageTable(type, displayedYear);
  Navadmin.messageDownloads.queueYear(type, displayedYear, true);
  setUIInLoadingStatus(!hasMessageList, hasMessageList ? null : 'Getting available messages');

  getYearsForMsgType(type, [], function onYearsLoaded(yearsResult) {
    if (listSelection !== selection) {
      console.log('Ignoring the year list for ' + listName + ' because the selection changed.');
      if (displayedYear > 0 && !Navadmin.messageStore.messages(type, displayedYear)) {
        getYearsForMsgType(type, [displayedYear], function() {
          Navadmin.messageDownloads.queueYear(type, displayedYear, false);
        }, true);
      }
      return;
    }
    var responseYear = setFilterMsgYearDropdown(type, year);
    if (responseYear != displayedYear) {
      console.log('The latest available year for ' + listName + ' changed to ' + responseYear + '.');
      displayedYear = responseYear;
      hasMessageList = refreshMessageTable(type, displayedYear);
      Navadmin.messageDownloads.queueYear(type, displayedYear, true);
      setUIInLoadingStatus(!hasMessageList, hasMessageList ? null : 'Getting available messages');
    }
    var yearName = shortNameForMessage(type, displayedYear).trim();
    if (displayedYear <= 0) {
      setUIInLoadingStatus(false, yearsResult.errorText);
      return;
    }
    getYearsForMsgType(type, [displayedYear], function onMetadataLoaded(metadataResult) {
      Navadmin.messageDownloads.queueYear(type, displayedYear, false);
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
 * Update the selected year's rows or apply a changed archive search.
 * @param {MsgType} msgType The message type to display.
 * @param {number} msgYear The resolved year to display.
 * @param {boolean} [showEmptyIfUnavailable] Show the empty row if the completed
 *   requests succeeded without providing a message list.
 * @returns {boolean} Whether a list is cached or the selected year can show an empty row.
 */
function refreshMessageTable(msgType, msgYear, showEmptyIfUnavailable) {
  listSelection.displayedYear = msgYear;
  listSelection.showEmptyIfUnavailable = showEmptyIfUnavailable;
  if (!selectedMessage) {
    setListTitle();
  }

  if (Navadmin.messageSearch.matcher(searchInput.value)) {
    msgFilterSearchInputChanged();
    return !!Navadmin.messageStore.messages(msgType, msgYear) || !!showEmptyIfUnavailable;
  }

  var rows = snapshotMessageRows(msgType, msgYear);
  if (rows === null && showEmptyIfUnavailable) {
    rows = [];
  }
  renderMessageRows(rows);
  return rows !== null;
}

function renderMessageRows(rows) {
  if (!displayedSearchRows) {
    var renderedRows = displayedRows && displayedRows.map(function(entry) { return entry.message; });
    if (JSON.stringify(rows) === JSON.stringify(renderedRows)) return;
  }
  displayedSearchRows = null;

  var table = $('#msg-list-table-body');
  var focusedMessage = findFocusedMessage(table[0]);
  table.empty();
  displayedRows = null;
  if (rows && rows.length === 0) {
    table.append('<tr><td></td><td>No messages available</td><td></td></tr>');
    displayedRows = [];
  } else if (rows) {
    var fragment = document.createDocumentFragment();
    displayedRows = rows.map(function(message) {
      var row = createMessageRow(message);
      fragment.appendChild(row[0]);
      return { message: message, row: row };
    });
    table.append(fragment);
  }

  if (focusedMessage && !focusMessageLink(focusedMessage)) {
    searchInput.focus();
  }
}

/**
 * Identify the rendered message link that would lose focus during a table redraw.
 * @param {HTMLElement} table The message table body.
 * @returns {Object|null} The message represented by the focused row.
 */
function findFocusedMessage(table) {
  var activeElement = document.activeElement;
  if (messageModalPhase !== 'hidden' || !displayedRows || !$.contains(table, activeElement)) {
    return null;
  }

  for (var i = 0; i < displayedRows.length; i++) {
    var entry = displayedRows[i];
    if ($.contains(entry.row[0], activeElement)) {
      return entry.message;
    }
  }
  return null;
}

/**
 * Restore focus to the current visible subject link for a message.
 * @param {Object|null} message The message type, year, and number to locate.
 * @returns {boolean} Whether its subject link received focus.
 */
function focusMessageLink(message) {
  if (!message || !displayedRows) {
    return false;
  }

  for (var i = 0; i < displayedRows.length; i++) {
    var entry = displayedRows[i];
    if (entry.message.type == message.type && entry.message.year == message.year &&
        entry.message.number == message.number) {
      var link = entry.row.find('a:visible')[0];
      if (link) {
        link.focus();
        return document.activeElement === link;
      }
      break;
    }
  }
  return false;
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
  return messages.filter(Boolean).reverse().map(function(message) {
    return snapshotMessageRow(msgType, msgYear, message);
  });
}

function snapshotMessageRow(type, year, message) {
  var cached = Navadmin.messageStore.getBodyStatus(type, year, message.number);
  var row = {
    type: type,
    year: year,
    number: message.number,
    title: message.title || '',
    cancelled: !!message.cancelled,
    offline: !!cached && cached.status === 200 && cached.persistent,
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
  return row;
}

/**
 * Build a clickable table row with the subject, offline indicator, activity counts, and optional highlighted snippet.
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
  if (message.snippet) {
    Navadmin.messageSearch.appendSnippet(subject[0], message.snippet);
  }

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

function cacheSearchBody(state, record, onlyIfMissing) {
  var yearBodies = state.bodies.get(record.year);
  if (!yearBodies) {
    yearBodies = new Map();
    state.bodies.set(record.year, yearBodies);
  }
  if (!onlyIfMissing || !yearBodies.has(record.number)) {
    yearBodies.set(record.number, { text: record.body });
  }
}

/**
 * Read cached bodies one year at a time for the active Full Message search.
 * @param {Object} state The archive cache for the selected message type.
 */
function loadArchiveSearchBodies(state) {
  if (state.readingBodies) {
    return;
  }
  var year = Navadmin.messageStore.bodyYears(state.type).filter(function(candidate) {
    return !state.readBodyYears.has(candidate);
  })[0];
  if (!year) {
    return;
  }
  var read = { year: year, evicted: false };
  state.readingBodies = read;
  state.readBodyYears.add(year);
  Navadmin.messageStore.listBodyRecords(state.type, year, function(records) {
    state.readingBodies = null;
    if (archiveSearch === state) {
      records.forEach(function(record) {
        if (record.status === 200 && (!read.evicted || hasSessionBody(state.type, year, record.number))) {
          cacheSearchBody(state, record, true);
        }
      });
      refreshArchiveSearchSoon();
      if (activeSearch && activeSearch.fullMessage) {
        loadArchiveSearchBodies(state);
      }
    }
  });
}

function loadArchiveSearchTitles(state) {
  if (state.readingTitles) {
    return;
  }
  var store = Navadmin.messageStore;
  var missing = store.years(state.type).filter(function(year) {
    return year > 0 && !state.requestedTitleYears.has(year) && !store.messages(state.type, year);
  });
  if (!missing.length) {
    return;
  }
  state.readingTitles = true;
  missing.forEach(function(year) { state.requestedTitleYears.add(year); });
  getYearsForMsgType(state.type, missing, function() {
    state.readingTitles = false;
    if (archiveSearch === state) {
      missing.forEach(function(year) { queueYearDownloadStatus(state.type, year); });
      if (activeSearch && !activeSearch.fullMessage) loadArchiveSearchTitles(state);
      hideSearchLoadingIndicatorWhenIdle();
    }
  }, true);
}

function hideSearchLoadingIndicatorWhenIdle() {
  if (!searchLoadingRow.parentNode) return;
  var search = activeSearch;
  var readingArchive = search && archiveSearch &&
    (search.fullMessage ? archiveSearch.readingBodies : archiveSearch.readingTitles);
  if (search && (search.timer || search.running || readingArchive)) return;
  searchLoadingRow.parentNode.removeChild(searchLoadingRow);
}

function refreshArchiveSearchSoon() {
  if (activeSearch) {
    activeSearch.needsRefresh = true;
    scheduleArchiveSearch(activeSearch, 220);
  }
}

function scheduleArchiveSearch(search, delay) {
  if (search.timer || search.running) {
    return;
  }
  search.timer = window.setTimeout(function() {
    search.timer = null;
    if (activeSearch === search) {
      runArchiveSearch(search);
    }
  }, delay);
}

function archiveSearchCandidates(state, fullMessage) {
  var store = Navadmin.messageStore;
  var candidates = [];
  if (fullMessage) {
    state.bodies.forEach(function(bodies, year) {
      bodies.forEach(function(body, number) {
        candidates.push({ year: year, number: number, body: body });
      });
    });
  } else {
    store.years(state.type).forEach(function(year) {
      var messages = store.messages(state.type, year) || [];
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i]) {
          candidates.push({ year: year, number: messages[i].number, message: messages[i] });
        }
      }
    });
  }
  return candidates;
}

function archiveSearchRow(search, candidate, metadataByYear) {
  var message = candidate.message;
  if (!search.fullMessage) {
    return search.matcher.test(message.title || '') ? snapshotMessageRow(search.type, candidate.year, message) : null;
  }

  var snippet = Navadmin.messageSearch.cachedBodySnippet(candidate.body, search.matcher);
  if (!snippet) {
    return null;
  }

  var messages = metadataByYear.get(candidate.year);
  if (!messages) {
    messages = new Map();
    (Navadmin.messageStore.messages(search.type, candidate.year) || []).forEach(function(metadata) {
      if (metadata) messages.set(metadata.number, metadata);
    });
    metadataByYear.set(candidate.year, messages);
  }
  message = messages.get(candidate.number) || { number: candidate.number };
  var row = snapshotMessageRow(search.type, candidate.year, message);
  row.snippet = snippet;
  return row;
}

function runArchiveSearch(search) {
  search.running = true;
  search.needsRefresh = false;
  if (search.fullMessage) {
    loadArchiveSearchBodies(archiveSearch);
  } else {
    loadArchiveSearchTitles(archiveSearch);
  }

  var candidates = archiveSearchCandidates(archiveSearch, search.fullMessage);
  var metadataByYear = new Map();
  var rows = [];
  var rowIndex = new Map();
  var position = 0;
  function scanBatch() {
    if (activeSearch !== search) {
      return;
    }
    var deadline = Date.now() + 8;
    // Yield both the text scan and detached row construction to the browser.
    do {
      var candidate = candidates[position++];
      if (!candidate) break;
      var message = archiveSearchRow(search, candidate, metadataByYear);
      if (message) {
        var key = searchRowKey(candidate.year, candidate.number);
        var entry = displayedSearchRows && displayedSearchRows.get(key);
        if (!entry || JSON.stringify(entry.message) !== JSON.stringify(message)) {
          entry = { message: message, row: createMessageRow(message) };
        }
        rows.push(entry);
        rowIndex.set(key, entry);
      }
    } while (position < candidates.length && Date.now() < deadline);

    if (position < candidates.length) {
      window.setTimeout(scanBatch, 0);
      return;
    }
    if (search.fullMessage) {
      rows.sort(function(a, b) {
        return b.message.year - a.message.year || b.message.number - a.message.number;
      });
    }
    showArchiveSearchRows(rows, rowIndex);
    search.running = false;
    if (search.needsRefresh) {
      scheduleArchiveSearch(search, 220);
    } else {
      hideSearchLoadingIndicatorWhenIdle();
    }
  }
  scanBatch();
}

function showArchiveSearchRows(rows, rowIndex) {
  var table = document.getElementById('msg-list-table-body');
  var focusedMessage = findFocusedMessage(table);
  if (!displayedSearchRows || !rows.length) {
    $(table).children().not(searchLoadingRow).remove();
  } else {
    displayedSearchRows.forEach(function(entry, key) {
      if (rowIndex.get(key) !== entry) entry.row.remove();
    });
  }

  var previousRow = table.firstElementChild;
  if (previousRow === searchLoadingRow) previousRow = previousRow.nextElementSibling;
  var fragment = document.createDocumentFragment();
  rows.forEach(function(entry) {
    var row = entry.row[0];
    if (row === previousRow) {
      if (fragment.firstChild) table.insertBefore(fragment, previousRow);
      previousRow = previousRow.nextElementSibling;
    } else {
      var message = entry.message;
      if (!message.offline) {
        var saved = Navadmin.messageStore.getBodyStatus(message.type, message.year, message.number);
        if (saved && saved.status === 200 && saved.persistent) markRowOffline(entry);
      }
      fragment.appendChild(row);
    }
  });
  if (fragment.firstChild) table.appendChild(fragment);

  displayedRows = rows;
  displayedSearchRows = rowIndex;
  if (focusedMessage && !table.contains(document.activeElement) && !focusMessageLink(focusedMessage)) {
    searchInput.focus();
  }
}

/**
 * Filter the selected message type across years with a case-insensitive literal match.
 * Full Message searches cached bodies and Title Only searches subjects.
 * Clearing the query restores the selected year's list.
 * @param {boolean} [userInitiated] Show a loading row for changes made through the search controls.
 */
function msgFilterSearchInputChanged(userInitiated) {
  if (!listSelection) {
    return;
  }
  var query = searchInput.value;
  var fullMessage = Navadmin.messageSearch.isFullMessage();
  if (activeSearch && activeSearch.query === query && activeSearch.fullMessage === fullMessage &&
      activeSearch.type === listSelection.type) {
    return;
  }
  var previousSearch = activeSearch;
  if (previousSearch) {
    window.clearTimeout(previousSearch.timer);
    if (previousSearch.type !== listSelection.type && displayedSearchRows) renderMessageRows(null);
  }
  activeSearch = null;
  var matcher = Navadmin.messageSearch.matcher(query);
  if (!userInitiated || !matcher) {
    hideSearchLoadingIndicatorWhenIdle();
  }
  if (!matcher) {
    if (archiveSearch) archiveSearch.requestedTitleYears.clear();
    if (previousSearch || displayedSearchRows) {
      refreshMessageTable(listSelection.type, listSelection.displayedYear, listSelection.showEmptyIfUnavailable);
    }
    return;
  }
  if (!archiveSearch) {
    archiveSearch = { type: listSelection.type, bodies: new Map(), readBodyYears: new Set(), requestedTitleYears: new Set() };
  }
  activeSearch = { type: listSelection.type, query: query, fullMessage: fullMessage, matcher: matcher };
  if (userInitiated && !searchLoadingRow.parentNode) {
    var table = document.getElementById('msg-list-table-body');
    table.insertBefore(searchLoadingRow, table.firstChild);
  }
  scheduleArchiveSearch(activeSearch, 140);
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

  if (!hasMessage && selectedMessage) {
    messageToRestoreFocus = selectedMessage;
    selectedMessage = null;
  }
  if (!listSelection || listSelection.type != list.type || listSelection.year != list.year) {
    loadMessageList(list.type, list.year);
  }
  if (hasMessage) {
    showMessage(route.type, route.year, route.number, entry.depth, null, entry.opener);
  } else {
    if (messageModalPhase === 'shown') {
      msgModal.modal('hide');
    }
    setListTitle();
    restoreMessageFocus();
  }
}

/**
 * Open a message from the table and add its browser history entry.
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
  var opener = selectedMessage ? selectedMessage.opener : null;
  if (!selectedMessage && row) {
    opener = { type: type, year: year, number: number };
  }
  var depth = Navadmin.navigation.pushMessage(type, year, number, listSelection, selectedMessage, opener);
  showMessage(type, year, number, depth, row, opener);
}

/**
 * Show the message modal and fetch its metadata and body as needed.
 * @param {MsgType} type The message type to display.
 * @param {number} year The message year.
 * @param {number} number The message number.
 * @param {number} depth The number of browser history entries to go back when
 *   closing the modal. Use 0 when there is no originating list entry.
 * @param {jQuery|null} [row] The table row whose cursor shows download progress.
 * @param {Object|null} [opener] The original subject link’s type, year, and number.
 */
function showMessage(type, year, number, depth, row, opener) {
  var message = { type: type, year: year, number: number, depth: depth, opener: opener };
  selectedMessage = message;
  messageToRestoreFocus = null;

  var messageName = setMessageTitle(message);
  if (messageModalPhase === 'shown') {
    // Move focus before replacing the message field in an already open dialog.
    focusMessageHeading();
  }
  var spinner = $('<span>', {
    'class': 'spinner-border spinner-border-sm mr-2',
    'aria-hidden': 'true'
  });
  msgModalBody.empty().append(spinner, document.createTextNode('Retrieving message\u2026'));
  if (messageModalPhase === 'hidden') {
    msgModal.modal('show');
  }
  if (row) {
    row.css('cursor', 'progress');
  }

  if (!Navadmin.messageStore.findMessage(type, year, number)) {
    console.log('No cached list entry for ' + messageName + '. Requesting its year metadata.');
    getYearsForMsgType(type, [year], function() {
      if (selectedMessage === message) {
        setMessageTitle(message);
      }
    });
  }

  getMsgBody(type, year, number, function(body, errorText) {
    if (row) {
      row.css('cursor', 'pointer');
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
    var messageText = $('<textarea>', {
      'class': 'form-control message-text',
      'aria-label': 'Message text',
      'readonly': true,
      'rows': 12,
      'wrap': 'soft'
    }).val(body);
    msgModalBody.empty().append(messageText);

    if (typeof analytics !== 'undefined') {
      analytics.logEvent('ViewedMessage', { messageNumber: messageName });
    }
    sendViewActivity(type, year, number);
  });
}

/**
 * Start reading a newly opened or selected message at its heading.
 */
function focusMessageHeading() {
  msgModal.scrollTop(0);
  msgModalTitle[0].focus();
}

/**
 * Return focus to the opener after both the modal and list route settle.
 * Direct links and missing rows use the year filter as the return point.
 */
function restoreMessageFocus() {
  if (!messageToRestoreFocus || messageModalPhase !== 'hidden') {
    return;
  }

  var route = Navadmin.navigation.readRoute(window.location.href);
  if (route.number > 0 || listSelection.type !== route.type || listSelection.year !== route.year) {
    return;
  }

  var opener = messageToRestoreFocus.opener;
  messageToRestoreFocus = null;
  if (!focusMessageLink(opener)) {
    document.getElementById('msg-year-dropdown').focus();
  }
}

/**
 * Update the modal title and page description using the cached subject.
 * @param {Object} message The current message selection.
 * @returns {string} The short message name used for logging and analytics.
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
  messageToRestoreFocus = selectedMessage;
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
