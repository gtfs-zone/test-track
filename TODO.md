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
