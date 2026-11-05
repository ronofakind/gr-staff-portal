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

-- Contacts for the new people (Ronnie OK'd, Nov 4): phone + email from QuickBooks vendors, else phone from the HUB. Never overwrites, never a duplicate email.
update staff s set phone = coalesce(nullif(s.phone,''), x.p),
                   email = coalesce(s.email, case when x.e is not null and not exists (select 1 from staff o where lower(o.email) = x.e) then x.e end)
  from (values
('Adele Ledoux','514-884-9796','adele.ledoux@hotmail.fr'),
('Andreea Nicolaev','514-577-5969','andreeabayev@gmail.com'),
('Ariel Azoulay','514-550-3745','ariel.azoulay08@yahoo.ca'),
('Avrum Max Busgang','438-932-7092','avrumbusgang@gmail.com'),
('Beatrice Ferron','438-394-0169','beatrice.ferron@hotmail.com'),
('Benjamin Azoulay','438-828-3458','ben.azoulay27@gmail.com'),
('Cameron Cohen','438-522-1700','camavic15@gmail.com'),
('Cameron Levitt','514-318-8388','camlevitt@gmail.com'),
('Christian Buitrago Gutierrez','438-993-7847','christiancambg2002@gmail.com'),
('Clara Finnen','917-795-5505','14finnenclara@gmail.com'),
('Colombe Broudehoux','438-458-8671','broudehouxcolombe@gmail.com'),
('Daniel Al Sokhn','438-540-4404','danysokhn@gmail.com'),
('Delnia Mohammadi','514-802-0095','delnia.mohammadi137475@gmail.com'),
('Dimitrios Danassis','514-559-0241','dimitriosdanassis@gmail.com'),
('Elika Khabibullina','438-223-7444','khab.elika@gmail.com'),
('Elliot Debargis','514-970-0191','elliott.debargis@gmail.com'),
('Emma Bilodeau-Cohen','514-621-5024','bilodeaucohenemma@gmail.com'),
('Ethan Sefler','514-652-0234','ethansef@icloud.com'),
('Eytan Amram Benezra','514-802-3504','eytanbenezra123@gmail.com'),
('Gaelle Joseph','581-578-1593','gaellejo@icloud.com'),
('Ilana Zini','514-965-9989','ilanazini@icloud.com'),
('Isaac Aizaman','514-569-9632','aizisa2003@outlook.com'),
('Joshua Liebman','514-654-6211','joshliebman03@gmail.com'),
('Julian Tayarah','+1 626-466-6125','juliant6270@gmail.com'),
('Juliette Brunel','+33769992951','juliette.brunel2009@gmail.com'),
('Karl Alvarado','514-963-5971','karljalvarado04@gmail.com'),
('Katia Keuylian','514-448-3353','k.keuylian@hotmail.com'),
('Kayla-Anne Maiorana','514-616-7297','m.kayla2k@gmail.com'),
('Laura Ferrarelli','514-647-4027','lauraferl@icloud.com'),
('Liam James Burton','438-406-1902','liamjamesburton@gmail.com'),
('Livia Rivera','514-213-3780','liviaariveraa21@gmail.com'),
('Lucciano Zamora-Lavanderos','514-662-6120','luccianozamora@hotmail.com'),
('Ludmila Martin','+33744725091','ludmila.mrtn29@gmail.com'),
('Mahaut Irion-Dewavrin','+33769443843','mahault.idew@icloud.com'),
('Manuela Flores Denti','613-600-2830','manuela.floresdenti98@gmail.com'),
('Noah Anzarut','514-431-9911','noah.anzarut@gmail.com'),
('Noah Berkowitz','514-473-8827','noahmaxberkowitz@gmail.com'),
('Olympia Dairaine','+33615033257','olympiadairaine@gmail.com'),
('Raphael Benhamou','438-855-4422','benhamou.raphael@icloud.com'),
('Ruth Aluha','819-919-7875','ruthaluha26@gmail.com'),
('Ryan Harper-Linton','514-569-9184','ryanharper206@gmail.com'),
('Ryan Rosen','514-869-7054','ryanmaxrosen@gmail.com'),
('Sacha Barbier Husson','438-365-2173','sacha.barbier-husson@hec.ca'),
('Sarah Romero','514-660-4090','sarahrofosa@hotmail.com'),
('Stefannie Taylor Georgoulis','514-804-0116','s.georgoulis@live.ca'),
('Sydney Jane Ross','438-459-4877','sydney.ross230409@gmail.com'),
('Thibault De Castelbajac','438-822-4049','thibault2castelbajac@gmail.com'),
('Thibault Outre','+33649859679','thibault-outre@hotmail.fr'),
('Tiesha Caballero','514-210-3170','tieshacaballero@outlook.com'),
('Tyler Ross','514-944-7599','tyler98ross@gmail.com'),
('Zoe Brouse-Lillini','438-866-1288','zoebrouselillini@gmail.com'),
('Amal Elghoul','514-226-2024',null),
('Anton Michener','647-865-7280',null),
('Axel Matei Sigouin Melasco','438-509-8191',null),
('Cynthia Mouvand','+33631179317',null),
('Loukhman Ali','263-550-0048',null),
('Massil Nordine','514-627-8963',null),
('Vileya Reynel Pillay','263-362-4798',null)
) as x(n, p, e)
 where s.full_name = x.n;

-- Reactivate the 6 (Ronnie, Nov 3)
update staff set active = true where full_name in ('Alicia Gonthier','Elodie Theriault','Kiara Petit--Erskine','Liza Charbonnier','Samantha Van Wingen','Tess Crombeen');

-- Lea Moreau: inactive (Ronnie, Nov 3) — kept for her past shifts and hours, hidden everywhere
update staff set active = false where full_name = 'Lea Morea';

-- Clean-up (Ronnie, Nov 4): duplicate Ronald Ladores → inactive (never deleted, history kept). "Unranked" stays active.
update staff set active = false
 where full_name = 'Ronald Ladores' and auth_user_id is null and role <> 'admin'
   and not exists (select 1 from shifts sh where sh.staff_id = staff.id)
   and (select count(*) from staff s2 where s2.full_name = 'Ronald Ladores' and s2.active) > 1;

select (select count(*) from staff) as staff_now, (select count(*) from staff where active) as active_now, (select count(*) from staff where active and (phone is not null or email is not null)) as active_with_contact,
       (select count(*) from staff where created_at > now() - interval '5 minutes') as added_now,
       (select count(*) from staff where created_at > now() - interval '5 minutes' and department='bar') as added_bar;
