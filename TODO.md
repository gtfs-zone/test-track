- (in Cafe Car) Add a list feeds endpoint to list all feed names. Use this api to generate examples. Show examples in dropdown like ../coloring-book. Filter out feeds with no vehicles
- In coloring-book copy route view back in

Lets revamp the Load button/process:
- Load button should open modal directly
- Lets add a public endpoint to ../cafe-car that lists nonempty feeds and use
  that to populate some results, combined with a set of hardcoded examples.
  After the verified feeds, we can list the transitland feeds
- It should be possible to specify feeds manually in the modal
- Show which URLS for each in the list
- Support #x.zip (a zip inside the zip containing the actual feed) Test with SEPTA https://github.com/septadev/GTFS/releases/latest/download/gtfs_public.zip#google_bus.zip
- We can remove the editable inputs in the right panel, and instead rely on the ability to reopen the modal and edit and then directly load a new feed. This should be a simpler and more robust mechanism.

https://viz.rt.gtfs.zone/#static=https%3A%2F%2Fgtfs.gptd.cadavl.com%2FGPTD%2FGTFS%2FGTFS_GPTD.zip&rt_vp=https%3A%2F%2Fgtfsrt.gptd.cadavl.com%2FProfilGtfsRt2_0RSProducer-GPTD%2FVehiclePosition.pb&rt_tu=https%3A%2F%2Fgtfsrt.gptd.cadavl.com%2FProfilGtfsRt2_0RSProducer-GPTD%2FTripUpdate.pb&rt_al=https%3A%2F%2Fgtfsrt.gptd.cadavl.com%2FProfilGtfsRt2_0RSProducer-GPTD%2FAlert.pb&cors=s%2Cr

https://viz.rt.gtfs.zone/#static=https%3A%2F%2Fcontent.amtrak.com%2Fcontent%2Fgtfs%2FGTFS.zip&rt_vp=%2Famtrak%2Fvehicle_positions.pb&rt_tu=%2Famtrak%2Ftrip_updates.pb&rt_al=%2Famtrak%2Fservice_alerts.pb&cors=s%2Cr

https://viz.rt.gtfs.zone/#static=https%3A%2F%2Fwww.data.gouv.fr%2Ffr%2Fdatasets%2Fr%2Fe0dbd217-15cd-4e28-9459-211a27511a34&rt_vp=https%3A%2F%2Fproxy.transport.data.gouv.fr%2Fresource%2Fdivia-dijon-gtfs-rt-vehicle-position&rt_tu=https%3A%2F%2Fproxy.transport.data.gouv.fr%2Fresource%2Fdivia-dijon-gtfs-rt-trip-update&cors=s%2Cr

https://viz.rt.gtfs.zone/#static=https%3A%2F%2Fripta.com%2FRIPTA-GTFS.zip&rt_vp=http%3A%2F%2Frealtime.ripta.com%3A81%2Fapi%2Fvehiclepositions%3Fformat%3Dgtfs.proto&rt_tu=http%3A%2F%2Frealtime.ripta.com%3A81%2Fapi%2Ftripupdates%3Fformat%3Dgtfs.proto&rt_al=http%3A%2F%2Frealtime.ripta.com%3A81%2Fapi%2Fservicealerts%3Fformat%3Dgtfs.proto&cors=s%2Cr

https://viz.rt.gtfs.zone/#static=https%3A%2F%2Fwcta.rideralerts.com%2FInfoPoint%2Fgtfs-zip.ashx&rt_vp=https%3A%2F%2Fwcta.rideralerts.com%2FInfoPoint%2Fgtfs-realtime.ashx%3Ftype%3Dvehicleposition&rt_tu=https%3A%2F%2Fwcta.rideralerts.com%2FInfoPoint%2Fgtfs-realtime.ashx%3Ftype%3Dtripupdate&rt_al=https%3A%2F%2Fwcta.rideralerts.com%2FInfoPoint%2Fgtfs-realtime.ashx%3Ftype%3Dalert&cors=s%2Cr

https://viz.rt.gtfs.zone/#static=https%3A%2F%2Frealtimelctabus.availtec.com%2FInfoPoint%2Fgtfs-zip.ashx&rt_vp=https%3A%2F%2Frealtimelctabus.availtec.com%2FInfoPoint%2FGTFS-Realtime.ashx%3FType%3DVehiclePosition&rt_tu=https%3A%2F%2Frealtimelctabus.availtec.comInfoPoint%2FGTFS-Realtime.ashx%3FType%3DTripUpdate&rt_al=https%3A%2F%2Frealtimelctabus.availtec.com%2FInfoPoint%2FGTFS-Realtime.ashx%3FType%3DAlert&cors=s%2Cr

https://viz.rt.gtfs.zone/#static=https%3A%2F%2Fopendata.burlington.ca%2Fgtfs-rt%2FGTFS_Data.zip&rt_vp=https%3A%2F%2Fopendata.burlington.ca%2Fgtfs-rt%2FGTFS_VehiclePositions.pb&rt_tu=https%3A%2F%2Fopendata.burlington.ca%2Fgtfs-rt%2FGTFS_TripUpdates.pb&rt_al=https%3A%2F%2Fopendata.burlington.ca%2Fgtfs-rt%2FGTFS_ServiceAlerts.pb&cors=s%2Cr

https://viz.rt.gtfs.zone/#static=http%3A%2F%2Fgtfs.bigbluebus.com%2Fcurrent.zip&rt_vp=http%3A%2F%2Fgtfs.bigbluebus.com%2Fvehiclepositions.bin&rt_tu=http%3A%2F%2Fgtfs.bigbluebus.com%2Ftripupdates.bin&rt_al=http%3A%2F%2Fgtfs.bigbluebus.com%2Falerts.bin&cors=s%2Cr

https://viz.rt.gtfs.zone/#static=http%3A%2F%2Fwww.londontransit.ca%2Fgtfsfeed%2Fgoogle_transit.zip&rt_vp=http%3A%2F%2Fgtfs.ltconline.ca%2FVehicle%2FVehiclePositions.pb&rt_tu=http%3A%2F%2Fgtfs.ltconline.ca%2FTripUpdate%2FTripUpdates.pb&rt_al=http%3A%2F%2Fgtfs.ltconline.ca%2FAlert%2FAlerts.pb&cors=s%2Cr
