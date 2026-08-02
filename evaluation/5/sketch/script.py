import cadquery as cq

# Create the base box
result = cq.Workplane('XY').box(15, 15, 5)

# Cut a rectangular hole based on the sketch data
result = result.faces(">Z").workplane().rect(13.3, 14.2).cutThruAll()

# Create the revolved zigzag profile
profile = (
    cq.Workplane("XY")
    .polyline([
        (0, -5.6),
        (4.7, -5.5),
        (0.3, -2.3),
        (2.7, -0.9),
        (2.4, 1.0),
        (0.3, 2.4),
        (4.9, 5.3),
        (0, 5.6)
    ])
    .close()
    .revolve(360, (0, 0, 0), (0, 1, 0))
)

# Combine the frame and the revolved solid
result = result.union(profile)

show_object(result)