@echo off
rem LoadBoot dev — starts all 4 portals with NO-CACHE serving (fresh files every refresh)
start "LB 8080 carrier" cmd /k python scripts\dev_server.py 8080
start "LB 8081 broker" cmd /k python scripts\dev_server.py 8081
start "LB 8082 shipper" cmd /k python scripts\dev_server.py 8082
start "LB 8083 command-center" cmd /k python scripts\dev_server.py 8083
echo All 4 dev servers started (no-cache). Close their windows to stop.
