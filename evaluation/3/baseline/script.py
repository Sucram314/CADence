import cadquery as cq

leg_length = 5
beam_length = 20
thickness = 1

class TargetEdges(cq.Selector):
    def filter(self, objectList):
        selected = []
        for o in objectList:
            if isinstance(o, cq.Edge):
                bb = o.BoundingBox()
                # Check if the edge is parallel to Z (vertical)
                if bb.xlen < 1e-3 and bb.ylen < 1e-3:
                    c = o.Center()
                    # Two vertical edges on the front leg (X = leg_length)
                    if abs(c.x - leg_length) < 1e-3:
                        selected.append(o)
                    # Inner corner edge (X = thickness, Y = thickness)
                    elif abs(c.x - thickness) < 1e-3 and abs(c.y - thickness) < 1e-3:
                        selected.append(o)
        return selected

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
    .fillet(0.2)
)

show_object(result)