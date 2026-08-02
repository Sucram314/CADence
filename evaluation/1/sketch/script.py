import cadquery as cq

result = cq.Workplane('XY').box(15, 15, 5)

# Add bosses to the top face
result = (
    result.faces(">Z")
    .workplane()
    .rect(11, 11, forConstruction=True)
    .vertices()
    .circle(1)
    .extrude(2)
)

show_object(result)