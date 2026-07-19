# Tracker

A tracking system for vehicles, which works by creating a log for a given date for each device. It can accept data from:

- The Expo app `app/`
- Devices compatible with Traccar, using the Traccar forwarding endpoint defined in XML on the Traccar server (powered by 1NCE SIM cards)
- Devices compatible with flespi, using a flespi HTTP stream

These devices are generally powered by 1NCE SIM cards.

It uses a D1 database to store events, and a simple React Router 7 website to view them. The frontend website is in two logical halves:

- A daily tracking section, which essentially acts as a logbook
- An event tracking section, for trackers used at events (such as running races, cycling events, etc.). This is more intended for people to view the location of a device in real time, and see where it has been.

The logic for each is quite different, however as they share so many components they run on the same codebase. The website is in the `website/` folder.

## Tracking Devices

### Expo App

The Expo app is a simple app in the app/ folder which uploads location data to the server. It is designed to be run on a device with a GPS chip, such as a phone or tablet.

### ST909 Device

The device uses H02 protocol (port 5013)
You can SMS the device using https://portal.1nce.com/portal/customer/dashboard

To set a new address send a message saying `IP,10.10.10.10,5013` (replacing 10.10.10.10 with the IP of the traccar/flespi server)

Default address is `IP,27.aika168.com,8185`

![Device manual](/.github/manual-page1.jpg)
![Device manual](/.github/manual-page2.jpg)
![Device manual](/.github/manual-page3.jpg)

From a similar device online:

![Device Commands](/.github/device-commands-screenshot-1.png)
![Device Commands](/.github/device-commands-screenshot-2.png)

## Forwarders

### Traccar

You can use [traccar](https://github.com/traccar/traccar) as the intermediary for tracking devices with different protocols.

#### Setup Traccar forwarding

Stored in `/opt/traccar/conf/traccar.xml` on the traccar server.

<entry key='forward.enable'>true</entry>
<entry key='forward.type'>url</entry>
<entry key='forward.url'>https://[URL GOES HERE]/upload-traccar.json?name={name}&amp;status={status}&amp;deviceId={deviceId}&amp;protocol={protocol}&amp;deviceTime={deviceTime}&amp;fixTime={fixTime}&amp;valid={valid}&amp;latitude={latitude}&amp;longitude={longitude}&amp;altitude={altitude}&amp;speed={speed}&amp;course={course}&amp;accuracy={accuracy}&amp;statusCode={statusCode}</entry>
<entry key='forward.retry.enable'>true</entry>
<entry key='forward.retry.delay'>10000</entry>
<entry key='forward.retry.count'>1000</entry>
<entry key='forward.retry.limit'>1000</entry>
<entry key='event.forward.url'>https://[URL GOES HERE]/upload-traccar.json</entry>
<entry key='event.forward.type'>json</entry>

### flespi

For flespi HTTP streams, send `POST` requests to:

`https://[URL GOES HERE]/upload-flespi.json`

The endpoint accepts flespi message payloads as a single JSON object, an array of message objects, or wrapped in `result`, `messages`, or `data`.

It reads location and timestamp fields from either dot-notation keys (`position.latitude`) or nested objects (`position.latitude`) and stores them in the same events table used by other upload endpoints.
