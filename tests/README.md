# NAVADMIN Viewer Web tests

To run tests

1. Start test server in shell. Powershell example below:

   ```powershell
   $env:VIEWER_TEST_PORT = '8765'
   node .\tests\browser-server.cjs
   ```

2. Open `http://127.0.0.1:8765/` in the browser
