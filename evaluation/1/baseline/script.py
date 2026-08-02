import cadquery as cq

result = (
    cq.Workplane('XY')
    .box(15, 15, 5)
    .faces(">Z")
    .workplane()
    .rect(11, 11, forConstruction=True)
    .vertices()
    .circle(1.5)
    .extrude(3)
)

show_object(result)