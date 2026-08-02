import cadquery as cq

leg_length = 5
beam_length = 20
thickness = 1
fillet_radius = 0.2

class TargetEdges(cq.Selector):
    def filter(self, objectList):
        res = []
        for o in objectList:
            p1 = o.startPoint()
            p2 = o.endPoint()
            # Check if the edge is parallel to the Z-axis (extrusion direction)
            if abs(p1.x - p2.x) < 1e-3 and abs(p1.y - p2.y) < 1e-3:
                # Check if it matches one of the sketched target (X, Y) coordinates
                if (abs(p1.x - leg_length) < 1e-3 and abs(p1.y - 0) < 1e-3) or \
                   (abs(p1.x - leg_length) < 1e-3 and abs(p1.y - thickness) < 1e-3) or \
                   (abs(p1.x - thickness) < 1e-3 and abs(p1.y - thickness) < 1e-3):
                    res.append(o)
        return res

result = (
    cq.Workplane("XY")
    .moveTo(0, 0)
    .lineTo(leg_length, 0)
    .lineTo(leg_length, thickness)
    .lineTo(thickness, thickness)
    .lineTo(thickness, leg_length)
    .lineTo(0, leg_length)
    .close()
    .extrude(beam_length)
    .edges(TargetEdges())
    .fillet(fillet_radius)
)

show_object(result)