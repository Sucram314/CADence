import cadquery as cq

pts = [
    (0, 0),
    (10, 0),
    (15, 2.5),
    (10, 5),
    (8, 5),
    (8, 10),
    (10, 10),
    (15, 12.5),
    (10, 15),
    (0, 15)
]

result = (
    cq.Workplane("XY")
    .polyline(pts)
    .close()
    .revolve(360, (0, 0, 0), (0, 1, 0))
    .faces(">Y")
    .workplane()
    .rect(5, 5)
    .cutThruAll()
)

show_object(result)