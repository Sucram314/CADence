import cadquery as cq

length = 50

h_width = 20
h_height = 20
h_web_thickness = 3
h_flange_thickness = 3
h_offset_x = -30

l_width = 12
l_height = 24
l_thickness = 2
l_offset_x = 0

t_width = 20
t_height = 20
t_web_thickness = 2.5
t_flange_thickness = 2.5
t_offset_x = 30

h_base_wp = cq.Workplane('XY').center(h_offset_x, 0)
h_web = h_base_wp.box(h_web_thickness, h_height - 2 * h_flange_thickness, length)
h_top_flange = h_base_wp.center(0, (h_height - h_flange_thickness) / 2).box(h_width, h_flange_thickness, length)
h_bottom_flange = h_base_wp.center(0, -(h_height - h_flange_thickness) / 2).box(h_width, h_flange_thickness, length)

h_beam = h_web.union(h_top_flange).union(h_bottom_flange)
h_beam = h_beam.edges(cq.selectors.BoxSelector((-28.6, -7.1, -100), (-28.4, -6.9, 100))).fillet(1.0)
model = h_beam

l_base_wp = cq.Workplane('XY').center(l_offset_x, 0)
l_vert_leg = l_base_wp.center(-l_width / 2 + l_thickness / 2, 0).box(l_thickness, l_height, length)
l_horiz_leg = l_base_wp.center(0, -l_height / 2 + l_thickness / 2).box(l_width, l_thickness, length)

l_beam = l_vert_leg.union(l_horiz_leg)
l_beam = l_beam.edges(cq.selectors.BoxSelector((-4.1, -10.1, -100), (-3.9, -9.9, 100))).fillet(1.0)
model = model.union(l_beam)  

t_base_wp = cq.Workplane('XY').center(t_offset_x, 0)
t_web = t_base_wp.center(0, -t_flange_thickness / 2).box(t_web_thickness, t_height - t_flange_thickness, length)
t_top_flange = t_base_wp.center(0, (t_height - t_flange_thickness) / 2).box(t_width, t_flange_thickness, length)

t_bar = t_web.union(t_top_flange)
t_bar = t_bar.edges(cq.selectors.BoxSelector((28.65, 7.4, -100), (28.85, 7.6, 100))).fillet(1.0)
model = model.union(t_bar)

show_object(model)