# Load data timeline — who needs what, WHEN (audit result, July 8 2026)

## 1. AT POST TIME (broker → collected by the wizard, ALL enforced required)
Everything CC needs to approve & forward to the board, and everything a carrier needs to DECIDE:
full facility addresses + GPS pins + ZIP · FCFS/appointment choice per stop + windows/appt times
(system-validated: future-only, HOS-feasible transit) · equipment/size/commodity/weight/pallets/
temp/tarps · full rate + auto RPM + real miles · complete accessorial rate card (detention/layover/
TONU/lumper/driver-assist/extra-stop) · hazmat declaration · loading methods + driver-assist/team
flags + service-rate consent · cargo value · reference · emergency-policy acceptance.
CC account gate: broker org must be ACTIVE (full packet: W-9, COI, bond, agreement, authority).
=> CC ke paas approval ke liye sab kuch post hote hi hota hai. ✔

## 2. AFTER BOOKING, BEFORE DISPATCH (broker → checklist, does NOT block the board)
Industry-correct timing — the shipper issues these once the appointment is set:
pickup/PU number · delivery number · appointment confirmation · billing contact (pre-invoice).
Rate confirmation: broker signs the auto-generated executed doc; carrier identity auto-attaches
at booking. Checklist tracked per load (Documents modal), dispatch verifies each item.

## 3. CARRIER — PRE-BOOKING (board): decision pack only
City/ST lane · windows/dock scheduling · freight details · full rate card · requirements.
Locked (anti-disintermediation), shown as "🔒 You get this the moment you ACCEPT":
exact street addresses, PU/DEL numbers, appointment confirmation, executed rate con, trip map.

## 4. CARRIER — POST-BOOKING (trip drawer "🔓 Dispatch pack")
cc_pocket_trip_docs (0076, both DBs): exact pickup/delivery street addresses, dock hours,
PU number, delivery number, appointment, rate-con executed status + ref, load reference.
Items the broker hasn't provided yet show "pending from broker" (checklist chases them).
