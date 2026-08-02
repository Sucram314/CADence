import cadquery as cq

result = cq.Workplane('XY').box(15, 15, 5)

# Circle in top left
result = result.faces(">Z").workplane().center(-4, 4).circle(1.5).cutThruAll()

# Horizontal ellipse in top right
result = result.faces(">Z").workplane().center(4, 4).ellipse(2.0, 1.0).cutThruAll()

# Vertical ellipse in bottom left
result = result.faces(">Z").workplane().center(-4, -4).ellipse(1.0, 2.0).cutThruAll()

# Rectangle in bottom right
result = result.faces(">Z").workplane().center(4, -4).rect(3.0, 2.0).cutThruAll()

show_object(result)