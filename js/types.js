MsgType = {
  NAVADMIN: 0,
  ALNAV: 1,
  MARADMIN: 2,
  ALMAR: 3,
  UNKNOWN: 4
}

function msgTypeToString(mt) {
  switch (mt) {
    case MsgType.NAVADMIN:
      return 'NAVADMIN';
    case MsgType.ALNAV:
      return 'ALNAV';
    case MsgType.MARADMIN:
      return 'MARADMIN';
    case MsgType.ALMAR:
      return 'ALMAR';
    default:
      return 'UNKNOWN';
  }
}

function stringToMsgType(mts) {
  switch (mts) {
    case 'NAVADMIN':
      return MsgType.NAVADMIN;
    case 'ALNAV':
      return MsgType.ALNAV;
    case 'MARADMIN':
      return MsgType.MARADMIN;
    case 'ALMAR':
      return MsgType.ALMAR;
    default:
      return MsgType.UNKNOWN;
  }
}

var NAVADMIN_VIEWER_TITLE = 'NAVADMIN Viewer App';
var COOKIE_VISITS = 'v';

var reDocument = new RegExp("((DODM|UFC|DOD INSTRUCTION|DODINST|DODI|DODD|DTM|SECNAVINST|CNICINST|NAVREGS|NAVPERS|MILPERSMAN|OPNAVINST|BUPERSINST|JAGINST|MCO) [A-Z]*[- ]?[0-9]+[-.\/ ]?[0-9]*[A-Z]?[- ]?[V]?[0-9]*)", "gi");
var reMessage = new RegExp("(NAVADMIN|ALNAV|MARADMIN|ALMAR) ([0-9]{3})\/([0-9]{2})", "g")