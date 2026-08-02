import cadquery as cq

result = cq.Workplane('XY').box(15, 15, 5)
show_object(result)