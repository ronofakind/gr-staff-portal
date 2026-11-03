-- Push 46 · staff missing in the app: worked Aug 1 – Oct 31 (Staff Payroll 2026) or listed in the HUB Rankings (60 people, Ronnie Nov 3)
-- No logins, nobody gets anything. Department = bar if the Events sheet only has them on bar lines, else floor.
insert into staff(full_name, department, active)
select x.n, coalesce((select case when bool_and(se.department='bar') then 'bar' else 'floor' end
   from sheet_events se, jsonb_array_elements(se.staff) p
  where upper(regexp_replace(p->>'name','\s+',' ','g')) = upper(x.n)), 'floor'), true
  from (values
('Adele Ledoux'),
('Amal Elghoul'),
('Andreea Nicolaev'),
('Anton Michener'),
('Ariel Azoulay'),
('Avrum Max Busgang'),
('Axel Matei Sigouin Melasco'),
('Beatrice Ferron'),
('Benjamin Azoulay'),
('Cameron Cohen'),
('Cameron Levitt'),
('Christian Buitrago Gutierrez'),
('Clara Finnen'),
('Colombe Broudehoux'),
('Cynthia Mouvand'),
('Daniel Al Sokhn'),
('Delnia Mohammadi'),
('Dimitrios Danassis'),
('Elika Khabibullina'),
('Elliot Debargis'),
('Emma Bilodeau-Cohen'),
('Ethan Sefler'),
('Eytan Amram Benezra'),
('Gaelle Joseph'),
('Ilana Zini'),
('Isaac Aizaman'),
('Isidora Victoria Cabrera'),
('Joshua Liebman'),
('Julian Tayarah'),
('Juliette Brunel'),
('Karl Alvarado'),
('Katia Keuylian'),
('Kayla-Anne Maiorana'),
('Laura Ferrarelli'),
('Liam James Burton'),
('Livia Rivera'),
('Loukhman Ali'),
('Lucciano Zamora-Lavanderos'),
('Ludmila Martin'),
('Mahaut Irion-Dewavrin'),
('Manuela Flores Denti'),
('Massil Nordine'),
('Noah Anzarut'),
('Noah Berkowitz'),
('Olympia Dairaine'),
('Raphael Benhamou'),
('Resia Laforesterie-Lamontagne'),
('Ruth Aluha'),
('Ryan Harper-Linton'),
('Ryan Rosen'),
('Sacha Barbier Husson'),
('Sarah Romero'),
('Stefannie Taylor Georgoulis'),
('Sydney Jane Ross'),
('Thibault De Castelbajac'),
('Thibault Outre'),
('Tiesha Caballero'),
('Tyler Ross'),
('Vileya Reynel Pillay'),
('Zoe Brouse-Lillini')
) as x(n)
 where not exists (select 1 from staff s where upper(s.full_name) = upper(x.n));

-- Reactivate the 6 (Ronnie, Nov 3)
update staff set active = true where full_name in ('Alicia Gonthier','Elodie Theriault','Kiara Petit--Erskine','Liza Charbonnier','Samantha Van Wingen','Tess Crombeen');

select (select count(*) from staff) as staff_now, (select count(*) from staff where active) as active_now,
       (select count(*) from staff where created_at > now() - interval '5 minutes') as added_now,
       (select count(*) from staff where created_at > now() - interval '5 minutes' and department='bar') as added_bar;
