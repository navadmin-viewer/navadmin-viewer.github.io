[![NAVADMIN Viewer icon](https://raw.githubusercontent.com/navadmin-viewer/recognizer/master/assets/Icon128.png)](https://apps.apple.com/us/app/navadmin-viewer/id1345135985)

## NAVADMIN Viewer web client

A limited web client [demo](https://navadmin-viewer.github.io/) for viewing Navy and Marine Corps administrative messages.

[![NAVADMIN Viewer web screenshot](https://raw.githubusercontent.com/navadmin-viewer/navadmin-viewer.github.io/master/assets/navadmin-viewer-web-screenshot.png)](https://navadmin-viewer.github.io/)

## Browser support tested 15APR2020

![Chrome](https://raw.githubusercontent.com/navadmin-viewer/navadmin-viewer.github.io/master/assets/browser-logos/chrome_48x48.png) | ![IE 11](https://raw.githubusercontent.com/navadmin-viewer/navadmin-viewer.github.io/master/assets/browser-logos/internet-explorer_9-11_48x48.png) | ![Edge](https://raw.githubusercontent.com/navadmin-viewer/navadmin-viewer.github.io/master/assets/browser-logos/edge_12-18_48x48.png) | ![Safari](https://raw.githubusercontent.com/navadmin-viewer/navadmin-viewer.github.io/master/assets/browser-logos/safari_48x48.png)| ![Firefox](https://raw.githubusercontent.com/navadmin-viewer/navadmin-viewer.github.io/master/assets/browser-logos/firefox_48x48.png) 
--- | --- | --- | --- | --- 
 Chrome | IE 11 | Edge | Safari | Firefox 
 80 ✔ | 11 ✔ | 44 ✔ | 13 ✔ | 75 ✔ 

## How to use

1. Go to [https://navadmin-viewer.github.io/](https://navadmin-viewer.github.io/).
2. Select the message type and year to browse.
3. Click the message you want to view.

### Sharing link parameters

You can create links which will automatically display a specific message by adding parameters to the URL. 

Examples:
> NAVADMIN 104/2020 ▶ https://navadmin-viewer.github.io/view-message/?type=NAVADMIN&year=2020&number=104
> 
> ALNAV 038/2020 ▶ https://navadmin-viewer.github.io/view-message/?type=ALNAV&year=2020&number=38

**Tip:**
*Adding `/view-message/?` path at the end of the URL before parameters will automatically launch the native NAVADMIN Viewer iOS and Android apps if installed.*

Parameter | Allowed Values | Description
--- | --- | --- | ---
`type` | NAVADMIN, ALNAV, MARADMIN, ALMAR | The shared message type.
`year` | 20xx | The shared message year.
`number` | xxx | The shared message number.

### FAQ

- Is this an official government product?
 
  No. NAVADMIN Viewer comes with no warranty or claim of accuracy. The user is responsible for verifying information with official sources. 

- Is there a native app for this?

  Yes. For [iOS](https://apps.apple.com/us/app/navadmin-viewer/id1345135985) and [Android](https://play.google.com/store/apps/details?id=com.ansonliu.navadmin). 

- Why not support *XXX* device? Can you make *XXX* feature?

  I probably don't have that device. You can send me *XXX* device for testing and pay me for consulting by [emailing me](mailto:support@ansonliu.com).

- Can I use your data feed in my own work?

  Please let me know before you do. Data transfer costs me money. Don't ruin it for everyone.

### Credits

All original code in NAVADMIN Viewer web client is available under terms of GPL-3.0.

NAVADMIN Viewer web client uses assets from the following projects. Thank you to all contributors of these projects.

- [Bootstrap](https://getbootstrap.com)

- [jQuery](https://jquery.com)

- [airra/browser-logos](https://github.com/alrra/browser-logos)
